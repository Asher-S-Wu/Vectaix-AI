import crypto from "node:crypto";
import { calculateQwenVoiceCloneCost } from "@/lib/server/credits/pricing";
import { creditErrorResponse } from "@/lib/server/credits/api";
import { CreditError } from "@/lib/server/credits/errors";
import {
  releaseMediaCredits,
  reserveMediaCredits,
  reviewMediaCredits,
  settleMediaCredits,
} from "@/lib/media/server/billing";
import {
  assertMediaCreditOperationUnused,
  requireMediaCreditOperation,
} from "@/lib/media/server/creditOperation";
import { getClientIP, rateLimit } from "@/lib/rateLimit";
import {
  parseJsonRequest,
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";
import { AUDIO_MODEL } from "@/lib/media/shared/models";
import { AUDIO_UPLOAD_PURPOSES } from "@/lib/media/shared/audioUploads";
import {
  deleteCustomVoice,
  isMissingCustomVoiceError,
  queryCustomVoice,
  updateCustomVoice,
} from "@/lib/media/server/qwenAudio";
import { serializeCustomVoice } from "@/lib/media/server/audioRecords";
import { transcodeAudioClip } from "@/lib/media/server/audioTranscoding";
import {
  claimAudioSources,
  deleteClaimedAudioSources,
  getAudioSourceAbsolutePath,
} from "@/lib/media/server/audioSourceUploads";
import { resolvePublicAppUrl } from "@/lib/modelRoutes";
import {
  assertMediaWriteLeaseActive,
  beginMediaWriteLease,
  endMediaWriteLease,
} from "@/lib/media/server/userOperationLeases";
import {
  createStoredFile,
  deleteStoredFilesByIds,
  deleteStoredFilesByOwner,
} from "@/lib/server/storage/service";
import CustomVoice from "@/models/CustomVoice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VOICE_QUERY_RATE_LIMIT = Object.freeze({ limit: 30, windowMs: 60 * 1000 });
const VOICE_MUTATION_RATE_LIMIT = Object.freeze({ limit: 5, windowMs: 10 * 60 * 1000 });
const MAX_JSON_BYTES = 32 * 1024;
const SAMPLE_TOKEN_TTL_MS = 15 * 60 * 1000;
const SAMPLE_FILE_TTL_MS = (24 * 60 - 15) * 60 * 1000;
const MUTATION_LEASE_MS = 15 * 60 * 1000;
const PROFILE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UPSTREAM_STATUSES = new Set(["DEPLOYING", "OK", "UNDEPLOYED"]);

function jsonMessage(message, status = 400) {
  return Response.json({ success: false, message }, { status });
}

function getErrorStatus(error, fallback = 500) {
  const status = Number(error?.status);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : fallback;
}

function getPublicErrorMessage(error, fallback) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("DASHSCOPE_SINGAPORE_API_KEY")) {
    return "语音服务密钥尚未配置";
  }
  if (message.includes("PUBLIC_APP_URL")) {
    return "声音复刻服务尚未配置公开访问地址";
  }
  return /[\u3400-\u9fff]/u.test(message) ? message : fallback;
}

function isAmbiguousVoiceUpdateError(error) {
  if (error?.name === "AbortError" || Number(error?.status) === 502) return true;
  return new Set([
    "UPSTREAM_CONNECTION_FAILED",
    "UPSTREAM_UNAVAILABLE",
    "INVALID_UPSTREAM_RESPONSE",
  ]).has(String(error?.code || ""));
}

function toDateValue(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function hasConfirmedRemoteUpdate(voice, upstream) {
  const backup = voice.remoteUpdateBackup;
  if (!backup) return false;
  if (upstream.status === "DEPLOYING" || upstream.status !== backup.status) return true;

  const previousModifiedAt = toDateValue(backup.upstreamModifiedAt);
  const currentModifiedAt = toDateValue(upstream.modifiedAt);
  const updateStartedAt = toDateValue(voice.remoteUpdateStartedAt);
  const updateStartedSecond = updateStartedAt
    ? Math.floor(updateStartedAt.getTime() / 1000) * 1000
    : null;
  return Boolean(
    currentModifiedAt
    && (
      (previousModifiedAt && currentModifiedAt.getTime() > previousModifiedAt.getTime())
      || (
        updateStartedSecond
        && currentModifiedAt.getTime() >= updateStartedSecond
        && (!previousModifiedAt || previousModifiedAt.getTime() < updateStartedSecond)
      )
    ),
  );
}

function buildVoiceUpdateRollback(backup, upstream) {
  return {
    displayName: backup.displayName,
    sampleFileId: backup.sampleFileId || null,
    sampleFileName: backup.sampleFileName || "",
    sampleTokenHash: backup.sampleTokenHash || null,
    sampleTokenExpiresAt: backup.sampleTokenExpiresAt || null,
    sampleExpiresAt: backup.sampleExpiresAt || null,
    consentConfirmedAt: backup.consentConfirmedAt || null,
    status: backup.status,
    lastStatusCheckedAt: new Date(),
    lastRequestId: upstream.requestId || backup.lastRequestId || "",
    upstreamModifiedAt: upstream.modifiedAt || backup.upstreamModifiedAt || null,
    remoteUpdateUncertain: false,
  };
}

async function getProfileId(context) {
  const params = await context?.params;
  const profileId = typeof params?.id === "string" ? params.id.trim() : "";
  return PROFILE_ID_PATTERN.test(profileId) ? profileId : "";
}

function normalizedSampleName(originalName) {
  const name = String(originalName || "声音样本").replace(/\.[^.]+$/u, "").trim() || "声音样本";
  return `${name.slice(0, 196)}.wav`;
}

function validateDisplayName(value, { required }) {
  if (value === undefined || value === null) {
    if (required) {
      throw Object.assign(new Error("请输入音色名称"), { status: 400 });
    }
    return null;
  }
  if (typeof value !== "string") {
    throw Object.assign(new Error("音色名称格式不正确"), { status: 400 });
  }
  const displayName = value.trim();
  if (!displayName || displayName.length > 40) {
    throw Object.assign(new Error("音色名称需为 1 到 40 个字符"), { status: 400 });
  }
  return displayName;
}

function rateLimitVoiceRequest(request, userId, profileId, mutation) {
  const limited = rateLimit(
    `media-audio-voice-${mutation ? "mutation" : "query"}:${userId}:${profileId}:${getClientIP(request)}`,
    mutation ? VOICE_MUTATION_RATE_LIMIT : VOICE_QUERY_RATE_LIMIT,
  );
  if (!limited.success) {
    throw Object.assign(
      new Error(mutation ? "声音复刻操作过于频繁，请稍后再试" : "状态刷新过于频繁，请稍后再试"),
      { status: 429 },
    );
  }
}

function hashSampleToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function findOwnedVoice(userId, profileId) {
  if (!profileId) return null;
  return CustomVoice.findOne({
    profileId,
    userId,
    model: AUDIO_MODEL,
  }).select([
    "+sampleTokenHash",
    "+mutationId",
    "+mutationStartedAt",
    "+remoteCreateUncertain",
    "+remoteUpdateUncertain",
    "+remoteUpdateStartedAt",
    "+remoteUpdateBackup",
  ].join(" "));
}

async function parsePatchInput(request) {
  const parsed = await parseJsonRequest(request, "请求内容格式错误", MAX_JSON_BYTES);
  if (!parsed.ok) {
    throw Object.assign(new Error("请求内容格式错误"), { status: parsed.response.status });
  }
  const body = parsed.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw Object.assign(new Error("请求内容格式错误"), { status: 400 });
  }
  const displayName = validateDisplayName(body.displayName, { required: false });
  const sampleUploadId = typeof body.sampleUploadId === "string"
    ? body.sampleUploadId.trim()
    : "";

  if (!sampleUploadId) {
    if (!displayName) {
      throw Object.assign(new Error("请填写新的音色名称或上传新的声音样本"), { status: 400 });
    }
    return { displayName, sampleUploadId: "", clipStart: null, clipEnd: null };
  }
  if (body.consent !== true) {
    throw Object.assign(new Error("请先确认已获得声音使用授权"), { status: 400 });
  }
  const clipStart = Number(body.clipStart);
  const clipEnd = Number(body.clipEnd);
  if (!Number.isFinite(clipStart) || !Number.isFinite(clipEnd)) {
    throw Object.assign(new Error("声音样本片段参数无效"), { status: 400 });
  }
  return { displayName, sampleUploadId, clipStart, clipEnd };
}

export async function GET(request, context) {
  let mediaWriteLease = null;
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    mediaWriteLease = await beginMediaWriteLease(user.userId);

    const profileId = await getProfileId(context);
    const voice = await findOwnedVoice(user.userId, profileId);
    if (!voice) return jsonMessage("复刻音色不存在", 404);

    rateLimitVoiceRequest(request, user.userId, profileId, false);
    let responseVoice = voice;
    const mutationIsStale = Boolean(
      voice.mutationId
      && voice.mutationStartedAt
      && new Date(voice.mutationStartedAt).getTime() <= Date.now() - MUTATION_LEASE_MS,
    );
    if (
      voice.voiceId
      && voice.status !== "DELETING"
      && (!voice.mutationId || mutationIsStale)
    ) {
      const upstream = await queryCustomVoice(voice.voiceId, { signal: request.signal });
      if (!UPSTREAM_STATUSES.has(upstream.status)) {
        throw new Error("阿里云返回了无法识别的音色状态");
      }
      const isReconcilingUpdate = Boolean(
        voice.remoteUpdateUncertain
        && voice.remoteUpdateBackup,
      );
      const updateConfirmed = isReconcilingUpdate
        ? hasConfirmedRemoteUpdate(voice, upstream)
        : false;
      const updateWindowExpired = isReconcilingUpdate && (
        !voice.sampleTokenExpiresAt
        || new Date(voice.sampleTokenExpiresAt).getTime() <= Date.now()
      );
      const currentSampleFileId = voice.sampleFileId || "";
      const previousSampleFileId = voice.remoteUpdateBackup?.sampleFileId || "";
      let cleanupSampleFileId = "";
      let update;

      if (isReconcilingUpdate && !updateConfirmed && updateWindowExpired) {
        cleanupSampleFileId = currentSampleFileId;
        update = {
          $set: buildVoiceUpdateRollback(voice.remoteUpdateBackup, upstream),
          $unset: {
            mutationId: 1,
            mutationStartedAt: 1,
            remoteUpdateStartedAt: 1,
            remoteUpdateBackup: 1,
          },
        };
      } else if (isReconcilingUpdate && !updateConfirmed) {
        update = {
          $set: {
            status: "DEPLOYING",
            upstreamCreatedAt: upstream.createdAt,
            lastStatusCheckedAt: new Date(),
            lastRequestId: upstream.requestId || null,
          },
          ...(mutationIsStale
            ? {
                $unset: {
                  mutationId: 1,
                  mutationStartedAt: 1,
                },
              }
            : {}),
        };
      } else {
        if (isReconcilingUpdate && previousSampleFileId !== currentSampleFileId) {
          cleanupSampleFileId = previousSampleFileId;
        }
        update = {
          $set: {
            status: upstream.status,
            upstreamCreatedAt: upstream.createdAt,
            upstreamModifiedAt: upstream.modifiedAt,
            lastStatusCheckedAt: new Date(),
            lastRequestId: upstream.requestId || null,
            ...(isReconcilingUpdate ? { remoteUpdateUncertain: false } : {}),
          },
          ...((mutationIsStale || isReconcilingUpdate)
            ? {
                $unset: {
                  ...(mutationIsStale
                    ? {
                        mutationId: 1,
                        mutationStartedAt: 1,
                      }
                    : {}),
                  ...(isReconcilingUpdate
                    ? {
                        remoteUpdateStartedAt: 1,
                        remoteUpdateBackup: 1,
                      }
                    : {}),
                },
              }
            : {}),
        };
      }

      await assertMediaWriteLeaseActive(mediaWriteLease);
      const syncedVoice = await CustomVoice.findOneAndUpdate(
        {
          _id: voice._id,
          userId: user.userId,
          model: AUDIO_MODEL,
          voiceId: voice.voiceId,
          ...(isReconcilingUpdate ? { remoteUpdateUncertain: true } : {}),
          ...(mutationIsStale
            ? {
                mutationId: voice.mutationId,
                mutationStartedAt: voice.mutationStartedAt,
              }
            : { mutationId: null }),
        },
        update,
        { new: true },
      ).select([
        "+sampleTokenHash",
        "+mutationId",
        "+mutationStartedAt",
        "+remoteCreateUncertain",
        "+remoteUpdateUncertain",
        "+remoteUpdateStartedAt",
        "+remoteUpdateBackup",
      ].join(" "));
      responseVoice = syncedVoice || await findOwnedVoice(user.userId, profileId);
      if (syncedVoice && cleanupSampleFileId) {
        await deleteStoredFilesByIds({
          userId: user.userId,
          fileIds: [cleanupSampleFileId],
          ownerType: "voice-profile",
          ownerId: profileId,
        }).catch((cleanupError) => {
          console.error("[Media Audio] cleanup reconciled voice sample:", cleanupError);
        });
      }
    }

    if (!responseVoice) return jsonMessage("复刻音色不存在", 404);
    return Response.json({ success: true, voice: serializeCustomVoice(responseVoice) });
  } catch (error) {
    console.error("[Media Audio] query custom voice:", error);
    return jsonMessage(
      getPublicErrorMessage(error, "读取复刻音色状态失败"),
      getErrorStatus(error),
    );
  } finally {
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((leaseError) => {
        console.error("[Media Audio] release media write lease:", leaseError);
      });
    }
  }
}

export async function PATCH(request, context) {
  let newSample = null;
  let previous = null;
  let userId = "";
  let profileId = "";
  let mutationId = "";
  let replacementLocked = false;
  let upstreamAccepted = false;
  let mediaWriteLease = null;
  let sourceOperationId = "";
  let billingOperationId = "";
  let reservation = null;
  let billing = null;
  let billingFinalized = false;
  let upstreamRequestIds = [];
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    userId = user.userId;
    profileId = await getProfileId(context);
    rateLimitVoiceRequest(request, user.userId, profileId, true);
    const input = await parsePatchInput(request);
    let creditOperation = null;
    if (input.sampleUploadId) {
      creditOperation = requireMediaCreditOperation(request, {
        userId: user.userId,
        feature: "qwen_voice_clone_replace",
        fingerprintInput: { profileId, ...input },
      });
      billingOperationId = creditOperation.operationId;
      await assertMediaCreditOperationUnused({
        operationId: billingOperationId,
        userId: user.userId,
        requestFingerprint: creditOperation.requestFingerprint,
      });
    }

    mediaWriteLease = await beginMediaWriteLease(user.userId);
    const voice = await findOwnedVoice(user.userId, profileId);
    if (!voice) return jsonMessage("复刻音色不存在", 404);

    if (!input.sampleUploadId) {
      await assertMediaWriteLeaseActive(mediaWriteLease);
      const renamed = await CustomVoice.findOneAndUpdate(
        {
          _id: voice._id,
          userId: user.userId,
          model: AUDIO_MODEL,
          status: { $ne: "DELETING" },
          mutationId: null,
          remoteUpdateUncertain: { $ne: true },
          updatedAt: voice.updatedAt,
        },
        { $set: { displayName: input.displayName } },
        { new: true },
      ).select("+remoteCreateUncertain");
      if (!renamed) {
        return jsonMessage("该音色正在执行其他操作，请稍后再修改名称", 409);
      }
      return Response.json({ success: true, voice: serializeCustomVoice(renamed) });
    }
    if (!voice.voiceId) {
      return jsonMessage("该音色尚未完成创建，不能替换样本", 409);
    }
    if (!["OK", "UNDEPLOYED"].includes(voice.status)) {
      return jsonMessage(
        "该音色正在审核或处理中，请稍后再替换样本",
        409,
      );
    }

    const settings = await (await import("@/lib/server/credits/settings")).getBillingSettings();
    reservation = await reserveMediaCredits({
      operationId: billingOperationId,
      userId: user.userId,
      feature: "media_audio_voice_clone",
      provider: "qwen",
      model: AUDIO_MODEL,
      estimate: calculateQwenVoiceCloneCost(settings),
      settings,
      usage: { action: "replace_sample", profileId },
      executionClaimId: creditOperation.executionClaimId,
      requestFingerprint: creditOperation.requestFingerprint,
    });

    sourceOperationId = crypto.randomUUID();
    const [source] = await claimAudioSources({
      userId: user.userId,
      fileIds: [input.sampleUploadId],
      purpose: AUDIO_UPLOAD_PURPOSES.VOICE_CLONE,
      operationId: sourceOperationId,
    });
    const normalized = await transcodeAudioClip({
      inputPath: getAudioSourceAbsolutePath(source),
      purpose: AUDIO_UPLOAD_PURPOSES.VOICE_CLONE,
      clipStart: input.clipStart,
      clipEnd: input.clipEnd,
      sourceMetadata: {
        duration: source.audioDuration,
        channels: source.audioChannels,
        sampleRate: source.audioSampleRate,
      },
      signal: request.signal,
    });
    const token = crypto.randomBytes(32).toString("base64url");
    const now = Date.now();
    await assertMediaWriteLeaseActive(mediaWriteLease);
    newSample = await createStoredFile({
      userId: user.userId,
      input: normalized.buffer,
      originalName: normalizedSampleName(source.originalName),
      mimeType: normalized.mimeType,
      extension: normalized.extension,
      category: "audio",
      kind: "voice-sample",
      ownerType: "voice-profile",
      ownerId: profileId,
      mediaWriteLease,
    });

    previous = {
      displayName: voice.displayName,
      sampleFileId: voice.sampleFileId,
      sampleFileName: voice.sampleFileName,
      sampleTokenHash: voice.sampleTokenHash,
      sampleTokenExpiresAt: voice.sampleTokenExpiresAt,
      sampleExpiresAt: voice.sampleExpiresAt,
      consentConfirmedAt: voice.consentConfirmedAt,
      status: voice.status,
      lastStatusCheckedAt: voice.lastStatusCheckedAt,
      lastRequestId: voice.lastRequestId,
      upstreamModifiedAt: voice.upstreamModifiedAt,
    };

    mutationId = crypto.randomUUID();
    await assertMediaWriteLeaseActive(mediaWriteLease);
    const lockedVoice = await CustomVoice.findOneAndUpdate(
      {
        _id: voice._id,
        userId: user.userId,
        model: AUDIO_MODEL,
        voiceId: voice.voiceId,
        status: voice.status,
        displayName: voice.displayName,
        sampleFileId: voice.sampleFileId || null,
        updatedAt: voice.updatedAt,
        $or: [
          { mutationId: null },
          { mutationStartedAt: { $lte: new Date(now - MUTATION_LEASE_MS) } },
        ],
      },
      {
        $set: {
          ...(input.displayName ? { displayName: input.displayName } : {}),
          sampleFileId: newSample.fileId,
          sampleFileName: source.originalName,
          sampleTokenHash: hashSampleToken(token),
          sampleTokenExpiresAt: new Date(now + SAMPLE_TOKEN_TTL_MS),
          sampleExpiresAt: new Date(now + SAMPLE_FILE_TTL_MS),
          consentConfirmedAt: new Date(),
          status: "SUBMITTING",
          mutationId,
          mutationStartedAt: new Date(),
          remoteUpdateUncertain: true,
          remoteUpdateStartedAt: new Date(),
          remoteUpdateBackup: previous,
        },
      },
      { new: true },
    ).select([
      "+sampleTokenHash",
      "+mutationId",
      "+mutationStartedAt",
      "+remoteUpdateUncertain",
      "+remoteUpdateStartedAt",
      "+remoteUpdateBackup",
    ].join(" "));
    if (!lockedVoice) {
      throw Object.assign(new Error("该音色正在执行其他操作，请稍后再试"), { status: 409 });
    }
    replacementLocked = true;

    const publicAppUrl = resolvePublicAppUrl();
    const audioUrl = `${publicAppUrl}/api/media/audio/voice-samples/${encodeURIComponent(profileId)}?token=${encodeURIComponent(token)}`;
    let upstream;
    try {
      await assertMediaWriteLeaseActive(mediaWriteLease);
      upstream = await updateCustomVoice({
        voiceId: lockedVoice.voiceId,
        audioUrl,
      });
      upstreamAccepted = true;
      upstreamRequestIds = [upstream.requestId].filter(Boolean);
    } catch (error) {
      if (isAmbiguousVoiceUpdateError(error)) {
        // 请求可能已经到达阿里云，保留新样本与待核对标记，不能回滚成旧的可用状态。
        upstreamAccepted = true;
        const preserved = await CustomVoice.updateOne(
          {
            _id: voice._id,
            userId: user.userId,
            model: AUDIO_MODEL,
            mutationId,
            remoteUpdateUncertain: true,
          },
          {
            $set: {
              status: "DEPLOYING",
              lastStatusCheckedAt: null,
              lastRequestId: error.requestId || "",
            },
            $unset: {
              mutationId: 1,
              mutationStartedAt: 1,
            },
          },
        );
        if (preserved.matchedCount !== 1) {
          console.error("[Media Audio] preserve uncertain voice update: record not found");
        }
      }
      throw error;
    }
    const settled = await settleMediaCredits({
      reservation,
      operationId: billingOperationId,
      userId: user.userId,
      actual: calculateQwenVoiceCloneCost(reservation.settings),
      usage: { action: "replace_sample", profileId },
      upstreamRequestIds,
    });
    billing = settled.billing;
    billingFinalized = true;
    const previousSampleFileId = previous.sampleFileId;

    await assertMediaWriteLeaseActive(mediaWriteLease);
    const completedVoice = await CustomVoice.findOneAndUpdate(
      {
        _id: voice._id,
        userId: user.userId,
        model: AUDIO_MODEL,
        mutationId,
      },
      {
        $set: {
          status: "DEPLOYING",
          lastRequestId: upstream.requestId || null,
          lastStatusCheckedAt: null,
          remoteUpdateUncertain: false,
        },
        $unset: {
          mutationId: 1,
          mutationStartedAt: 1,
          remoteUpdateStartedAt: 1,
          remoteUpdateBackup: 1,
        },
      },
      { new: true },
    ).select("+remoteCreateUncertain");
    if (!completedVoice) {
      throw new Error("保存复刻音色更新状态失败");
    }
    replacementLocked = false;
    newSample = null;
    previous = null;

    if (previousSampleFileId) {
      try {
        await deleteStoredFilesByIds({
          userId: user.userId,
          fileIds: [previousSampleFileId],
          ownerType: "voice-profile",
          ownerId: profileId,
        });
      } catch (cleanupError) {
        console.error("[Media Audio] remove previous voice sample:", cleanupError);
      }
    }

    return Response.json({ success: true, voice: serializeCustomVoice(completedVoice), billing });
  } catch (error) {
    if (reservation && !billingFinalized) {
      try {
        const result = upstreamAccepted
          ? await reviewMediaCredits({
              reservation,
              operationId: billingOperationId,
              userId,
              reason: "Qwen 自定义音色样本更换结果不明确",
              usage: { action: "replace_sample", profileId },
              upstreamRequestIds: upstreamRequestIds.length
                ? upstreamRequestIds
                : [error?.requestId].filter(Boolean),
            })
          : await releaseMediaCredits({
              reservation,
              operationId: billingOperationId,
              userId,
              usage: { action: "replace_sample", profileId },
              upstreamRequestIds: [error?.requestId].filter(Boolean),
            });
        billing = result.billing;
        billingFinalized = true;
      } catch (billingError) {
        console.error("[Media Audio] finalize voice replacement billing:", billingError);
      }
    }
    let canDeleteNewSample = Boolean(newSample && !replacementLocked);
    if (replacementLocked && !upstreamAccepted && previous && userId && profileId && mutationId) {
      try {
        const restored = await CustomVoice.findOneAndUpdate(
          {
            profileId,
            userId,
            model: AUDIO_MODEL,
            mutationId,
          },
          {
            $set: {
              ...previous,
              remoteUpdateUncertain: false,
            },
            $unset: {
              mutationId: 1,
              mutationStartedAt: 1,
              remoteUpdateStartedAt: 1,
              remoteUpdateBackup: 1,
            },
          },
          { new: true },
        );
        canDeleteNewSample = Boolean(restored);
      } catch (restoreError) {
        console.error("[Media Audio] restore custom voice after update failure:", restoreError);
      }
    }
    if (newSample && canDeleteNewSample && userId && profileId) {
      try {
        await deleteStoredFilesByIds({
          userId,
          fileIds: [newSample.fileId],
          ownerType: "voice-profile",
          ownerId: profileId,
        });
      } catch (cleanupError) {
        console.error("[Media Audio] cleanup replacement sample:", cleanupError);
      }
    }
    console.error("[Media Audio] update custom voice:", error);
    if (error instanceof CreditError) {
      return creditErrorResponse(error, "音色更新积分处理失败");
    }
    return Response.json(
      {
        success: false,
        message: getPublicErrorMessage(error, "更新复刻音色失败"),
        ...(billing ? { billing } : {}),
      },
      { status: getErrorStatus(error) },
    );
  } finally {
    if (sourceOperationId && userId) {
      await deleteClaimedAudioSources({
        userId,
        operationId: sourceOperationId,
      }).catch((error) => {
        console.error("[Media Audio] cleanup replacement source upload:", error);
      });
    }
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((leaseError) => {
        console.error("[Media Audio] release media write lease:", leaseError);
      });
    }
  }
}

export async function DELETE(request, context) {
  let mutationId = "";
  let claimedVoice = null;
  let mediaWriteLease = null;
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    mediaWriteLease = await beginMediaWriteLease(user.userId);

    const profileId = await getProfileId(context);
    const voice = await findOwnedVoice(user.userId, profileId);
    if (!voice) return jsonMessage("复刻音色不存在", 404);
    if (voice.remoteCreateUncertain && !voice.voiceId) {
      return jsonMessage("该音色的云端创建结果正在核对，暂时不能删除", 409);
    }
    if (voice.remoteUpdateUncertain) {
      return jsonMessage("该音色的云端更新结果正在核对，暂时不能删除", 409);
    }

    rateLimitVoiceRequest(request, user.userId, profileId, true);
    mutationId = crypto.randomUUID();
    await assertMediaWriteLeaseActive(mediaWriteLease);
    claimedVoice = await CustomVoice.findOneAndUpdate(
      {
        _id: voice._id,
        userId: user.userId,
        model: AUDIO_MODEL,
        remoteUpdateUncertain: { $ne: true },
        $or: [
          { mutationId: null },
          {
            mutationStartedAt: { $lte: new Date(Date.now() - MUTATION_LEASE_MS) },
          },
        ],
      },
      {
        $set: {
          status: "DELETING",
          mutationId,
          mutationStartedAt: new Date(),
        },
      },
      { new: true },
    ).select("+mutationId +mutationStartedAt");
    if (!claimedVoice) {
      return jsonMessage("该音色正在执行其他操作，请稍后再试", 409);
    }

    let requestId = claimedVoice.lastRequestId || "";
    if (claimedVoice.voiceId) {
      try {
        const upstream = await deleteCustomVoice(claimedVoice.voiceId);
        requestId = upstream.requestId || requestId;
      } catch (error) {
        if (!isMissingCustomVoiceError(error)) {
          await CustomVoice.updateOne(
            {
              _id: claimedVoice._id,
              userId: user.userId,
              model: AUDIO_MODEL,
              mutationId,
            },
            {
              $set: { status: "DELETING" },
              $unset: {
                mutationId: 1,
                mutationStartedAt: 1,
              },
            },
          ).catch((releaseError) => {
            console.error("[Media Audio] release failed voice deletion:", releaseError);
          });
          throw error;
        }
      }
    }

    await assertMediaWriteLeaseActive(mediaWriteLease);
    const detachedVoice = await CustomVoice.findOneAndUpdate(
      {
        _id: claimedVoice._id,
        userId: user.userId,
        model: AUDIO_MODEL,
        mutationId,
      },
      {
        $unset: {
          voiceId: 1,
          mutationId: 1,
          mutationStartedAt: 1,
        },
        $set: {
          status: "UNDEPLOYED",
          lastRequestId: requestId,
        },
      },
      { new: true },
    );
    if (!detachedVoice) {
      throw new Error("保存音色删除状态失败");
    }

    await assertMediaWriteLeaseActive(mediaWriteLease);
    await deleteStoredFilesByOwner({
      userId: user.userId,
      ownerType: "voice-profile",
      ownerId: profileId,
    });
    await CustomVoice.deleteOne({
      _id: detachedVoice._id,
      userId: user.userId,
      model: AUDIO_MODEL,
      voiceId: { $exists: false },
    });

    return Response.json({ success: true, deleted: true });
  } catch (error) {
    console.error("[Media Audio] delete custom voice:", error);
    return jsonMessage(
      getPublicErrorMessage(error, "删除复刻音色失败"),
      getErrorStatus(error),
    );
  } finally {
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((leaseError) => {
        console.error("[Media Audio] release media write lease:", leaseError);
      });
    }
  }
}
