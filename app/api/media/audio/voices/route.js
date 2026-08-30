import { modelAccessResponse } from "@/lib/server/guest/access";
import crypto from "node:crypto";
import { getClientIP, rateLimit } from "@/lib/rateLimit";
import {
  parseJsonRequest,
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";
import {
  AUDIO_LANGUAGE_HINTS,
  AUDIO_MODEL,
} from "@/lib/media/shared/models";
import {
  createCustomVoice,
  deleteCustomVoice,
} from "@/lib/media/server/qwenAudio";
import { serializeCustomVoice } from "@/lib/media/server/audioRecords";
import { cleanupExpiredVoiceSamples } from "@/lib/media/server/voiceSampleCleanup";
import { AUDIO_UPLOAD_PURPOSES } from "@/lib/media/shared/audioUploads";
import { transcodeAudioClip } from "@/lib/media/server/audioTranscoding";
import {
  claimAudioSources,
  cleanupExpiredAudioSourceUploads,
  deleteClaimedAudioSources,
  getAudioSourceAbsolutePath,
} from "@/lib/media/server/audioSourceUploads";
import {
  acquireVoiceCreationLease,
  assertMediaWriteLeaseActive,
  beginMediaWriteLease,
  endMediaWriteLease,
  releaseVoiceCreationLease,
} from "@/lib/media/server/userOperationLeases";
import { resolvePublicAppUrl } from "@/lib/modelRoutes";
import {
  createStoredFile,
  deleteStoredFilesByOwner,
} from "@/lib/server/storage/service";
import CustomVoice from "@/models/CustomVoice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VOICE_MUTATION_RATE_LIMIT = Object.freeze({ limit: 5, windowMs: 10 * 60 * 1000 });
const CUSTOM_VOICE_LIMIT = 20;
const MAX_JSON_BYTES = 32 * 1024;
const SAMPLE_TOKEN_TTL_MS = 15 * 60 * 1000;
const SAMPLE_FILE_TTL_MS = (24 * 60 - 15) * 60 * 1000;
const ALLOWED_LANGUAGE_HINTS = new Set(AUDIO_LANGUAGE_HINTS.map((item) => item.id).filter(Boolean));

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

function isAmbiguousVoiceCreationError(error) {
  if (error?.name === "AbortError" || Number(error?.status) === 502) return true;
  return new Set([
    "UPSTREAM_CONNECTION_FAILED",
    "UPSTREAM_UNAVAILABLE",
    "INVALID_UPSTREAM_RESPONSE",
  ]).has(String(error?.code || ""));
}

function hashSampleToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function createVoicePrefix() {
  const randomPart = BigInt(`0x${crypto.randomBytes(5).toString("hex")}`)
    .toString(36)
    .padStart(8, "0");
  return `vx${randomPart}`;
}

function normalizedSampleName(originalName) {
  const name = String(originalName || "声音样本").replace(/\.[^.]+$/u, "").trim() || "声音样本";
  return `${name.slice(0, 196)}.wav`;
}

function readCreateVoiceInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw Object.assign(new Error("请求内容格式错误"), { status: 400 });
  }
  const displayName = typeof body.displayName === "string"
    ? body.displayName.trim()
    : "";
  const languageHint = typeof body.languageHint === "string"
    ? body.languageHint.trim()
    : "zh";
  const enablePreprocess = body.enablePreprocess === true;
  const consent = body.consent === true;
  const sampleUploadId = typeof body.sampleUploadId === "string"
    ? body.sampleUploadId.trim()
    : "";
  const clipStart = Number(body.clipStart);
  const clipEnd = Number(body.clipEnd);

  if (!displayName || displayName.length > 40) {
    throw Object.assign(new Error("音色名称需为 1 到 40 个字符"), { status: 400 });
  }
  if (!ALLOWED_LANGUAGE_HINTS.has(languageHint)) {
    throw Object.assign(new Error("不支持的样本语言"), { status: 400 });
  }
  if (!consent) {
    throw Object.assign(new Error("请先确认已获得声音使用授权"), { status: 400 });
  }
  if (!sampleUploadId) {
    throw Object.assign(new Error("请选择声音样本"), { status: 400 });
  }
  if (!Number.isFinite(clipStart) || !Number.isFinite(clipEnd)) {
    throw Object.assign(new Error("声音样本片段参数无效"), { status: 400 });
  }

  return {
    displayName,
    languageHint,
    enablePreprocess,
    sampleUploadId,
    clipStart,
    clipEnd,
  };
}

export async function GET(request) {
  let mediaWriteLease = null;
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    mediaWriteLease = await beginMediaWriteLease(user.userId);

    await assertMediaWriteLeaseActive(mediaWriteLease);
    await cleanupExpiredAudioSourceUploads();
    await cleanupExpiredVoiceSamples(new Date(), user.userId);
    const voices = await CustomVoice.find({
      userId: user.userId,
      model: AUDIO_MODEL,
    })
      .select("+remoteCreateUncertain +remoteUpdateUncertain")
      .sort({ createdAt: -1 })
      .limit(CUSTOM_VOICE_LIMIT)
      .lean();

    return Response.json({
      success: true,
      voices: voices.map(serializeCustomVoice).filter(Boolean),
    });
  } catch (error) {
    console.error("[Media Audio] list custom voices:", error);
    return jsonMessage(getPublicErrorMessage(error, "读取复刻音色失败"), getErrorStatus(error));
  } finally {
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((error) => {
        console.error("[Media Audio] release media write lease:", error);
      });
    }
  }
}

export async function POST(request) {
  let profileId = "";
  let userId = "";
  let createdUpstreamVoiceId = "";
  let preserveLocalRecord = false;
  let mediaWriteLease = null;
  let voiceCreationLease = null;
  let sourceOperationId = "";
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    const accessError = modelAccessResponse(user, AUDIO_MODEL);
    if (accessError) return accessError;
    userId = user.userId;
    mediaWriteLease = await beginMediaWriteLease(user.userId);
    voiceCreationLease = await acquireVoiceCreationLease(user.userId);

    const clientIP = getClientIP(request);
    const limited = rateLimit(
      `media-audio-voice:${user.userId}:${clientIP}`,
      VOICE_MUTATION_RATE_LIMIT,
    );
    if (!limited.success) {
      return jsonMessage("声音复刻操作过于频繁，请稍后再试", 429);
    }

    const existingCount = await CustomVoice.countDocuments({
      userId: user.userId,
      model: AUDIO_MODEL,
    });
    if (existingCount >= CUSTOM_VOICE_LIMIT) {
      return jsonMessage(`每位用户最多保存 ${CUSTOM_VOICE_LIMIT} 个复刻音色`, 409);
    }

    const parsed = await parseJsonRequest(request, "请求内容格式错误", MAX_JSON_BYTES);
    if (!parsed.ok) return parsed.response;
    const input = readCreateVoiceInput(parsed.body);

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

    profileId = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString("base64url");
    const now = Date.now();
    const sampleTokenExpiresAt = new Date(now + SAMPLE_TOKEN_TTL_MS);
    const sampleExpiresAt = new Date(now + SAMPLE_FILE_TTL_MS);
    const prefix = createVoicePrefix();
    await assertMediaWriteLeaseActive(mediaWriteLease);
    const saved = await createStoredFile({
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

    const mutationId = crypto.randomUUID();
    let localVoice;
    try {
      await assertMediaWriteLeaseActive(mediaWriteLease);
      localVoice = await CustomVoice.create({
        profileId,
        userId: user.userId,
        displayName: input.displayName,
        prefix,
        voiceId: null,
        status: "SUBMITTING",
        model: AUDIO_MODEL,
        languageHint: input.languageHint,
        enablePreprocess: input.enablePreprocess,
        sampleFileId: saved.fileId,
        sampleFileName: source.originalName,
        sampleTokenHash: hashSampleToken(token),
        sampleTokenExpiresAt,
        sampleExpiresAt,
        consentConfirmedAt: new Date(),
        mutationId,
        mutationStartedAt: new Date(),
      });
    } catch (error) {
      await deleteStoredFilesByOwner({
        userId: user.userId,
        ownerType: "voice-profile",
        ownerId: profileId,
      });
      profileId = "";
      throw error;
    }

    const retainedVoiceIds = await CustomVoice.find({
      userId: user.userId,
      model: AUDIO_MODEL,
    })
      .sort({ createdAt: 1, _id: 1 })
      .limit(CUSTOM_VOICE_LIMIT)
      .select("_id")
      .lean();
    const retained = retainedVoiceIds.some(
      (item) => item._id.toString() === localVoice._id.toString(),
    );
    if (!retained) {
      await CustomVoice.deleteOne({ _id: localVoice._id, userId: user.userId });
      await deleteStoredFilesByOwner({
        userId: user.userId,
        ownerType: "voice-profile",
        ownerId: profileId,
      });
      profileId = "";
      return jsonMessage(`每位用户最多保存 ${CUSTOM_VOICE_LIMIT} 个复刻音色`, 409);
    }

    const publicAppUrl = resolvePublicAppUrl();
    const audioUrl = `${publicAppUrl}/api/media/audio/voice-samples/${encodeURIComponent(profileId)}?token=${encodeURIComponent(token)}`;
    await assertMediaWriteLeaseActive(mediaWriteLease);
    const requestMarked = await CustomVoice.updateOne(
      {
        profileId,
        userId: user.userId,
        model: AUDIO_MODEL,
        mutationId,
      },
      {
        $set: {
          remoteCreateUncertain: true,
        },
      },
    );
    if (requestMarked.matchedCount !== 1) {
      throw new Error("登记云端音色创建请求失败");
    }

    let upstream;
    try {
      upstream = await createCustomVoice({
        audioUrl,
        languageHint: input.languageHint,
        enablePreprocess: input.enablePreprocess,
        prefix,
      });
    } catch (error) {
      if (isAmbiguousVoiceCreationError(error)) {
        preserveLocalRecord = true;
        const preserved = await CustomVoice.updateOne(
          {
            profileId,
            userId: user.userId,
            model: AUDIO_MODEL,
            mutationId,
          },
          {
            $set: {
              remoteCreateUncertain: true,
              lastRequestId: error.requestId || "",
            },
            $unset: {
              mutationId: 1,
              mutationStartedAt: 1,
            },
          },
        );
        if (preserved.matchedCount !== 1) {
          console.error("[Media Audio] preserve uncertain voice creation: record not found");
        }
      } else {
        await CustomVoice.updateOne(
          {
            profileId,
            userId: user.userId,
            model: AUDIO_MODEL,
            mutationId,
          },
          {
            $set: {
              remoteCreateUncertain: false,
            },
          },
        ).catch((recoveryError) => {
          console.error("[Media Audio] clear failed voice creation marker:", recoveryError);
        });
      }
      throw error;
    }
    createdUpstreamVoiceId = upstream.voiceId;

    let voice;
    let upstreamVoiceAttached = false;
    try {
      await assertMediaWriteLeaseActive(mediaWriteLease);
      const attached = await CustomVoice.updateOne(
        {
          profileId,
          userId: user.userId,
          model: AUDIO_MODEL,
          mutationId,
        },
        {
          $set: {
            voiceId: upstream.voiceId,
            status: "DEPLOYING",
            lastRequestId: upstream.requestId || null,
            remoteCreateUncertain: false,
          },
        },
      );
      if (attached.matchedCount !== 1) {
        throw new Error("保存复刻音色标识失败");
      }
      upstreamVoiceAttached = true;
      createdUpstreamVoiceId = "";

      voice = await CustomVoice.findOneAndUpdate(
        {
          profileId,
          userId: user.userId,
          model: AUDIO_MODEL,
          mutationId,
          voiceId: upstream.voiceId,
        },
        {
          $set: {
            status: "DEPLOYING",
          },
          $unset: {
            mutationId: 1,
            mutationStartedAt: 1,
          },
        },
        { new: true },
      );
      if (!voice) {
        preserveLocalRecord = true;
        throw new Error("保存复刻音色状态失败");
      }
    } catch (persistError) {
      if (upstreamVoiceAttached) {
        preserveLocalRecord = true;
        throw persistError;
      }
      try {
        await deleteCustomVoice(upstream.voiceId);
        createdUpstreamVoiceId = "";
      } catch (compensationError) {
        preserveLocalRecord = true;
        try {
          const recovered = await CustomVoice.updateOne(
            {
              profileId,
              userId: user.userId,
              model: AUDIO_MODEL,
            },
            {
              $set: {
                voiceId: upstream.voiceId,
                status: "DEPLOYING",
                lastRequestId: upstream.requestId || null,
                remoteCreateUncertain: false,
              },
              $unset: {
                mutationId: 1,
                mutationStartedAt: 1,
              },
            },
          );
          if (recovered.matchedCount !== 1) {
            throw new Error("未找到需要保留的复刻音色记录");
          }
        } catch (recoveryError) {
          console.error(
            `[Media Audio] CRITICAL orphan voice ${upstream.voiceId}:`,
            recoveryError,
          );
        }
        console.error("[Media Audio] compensate failed voice creation:", compensationError);
      }
      throw persistError;
    }

    profileId = "";
    return Response.json({
      success: true,
      voice: serializeCustomVoice(voice),
    }, { status: 201 });
  } catch (error) {
    if (profileId && userId && !preserveLocalRecord && !createdUpstreamVoiceId) {
      try {
        await deleteStoredFilesByOwner({
          userId,
          ownerType: "voice-profile",
          ownerId: profileId,
        });
      } catch (cleanupError) {
        console.error("[Media Audio] cleanup failed voice sample:", cleanupError);
      }
      try {
        await CustomVoice.deleteOne({ profileId, userId });
      } catch (cleanupError) {
        console.error("[Media Audio] cleanup failed voice record:", cleanupError);
      }
    }
    console.error("[Media Audio] create custom voice:", error);
    return jsonMessage(getPublicErrorMessage(error, "声音复刻失败"), getErrorStatus(error));
  } finally {
    if (sourceOperationId && userId) {
      await deleteClaimedAudioSources({
        userId,
        operationId: sourceOperationId,
      }).catch((error) => {
        console.error("[Media Audio] cleanup voice source upload:", error);
      });
    }
    if (voiceCreationLease) {
      await releaseVoiceCreationLease(voiceCreationLease).catch((error) => {
        console.error("[Media Audio] release voice creation lease:", error);
      });
    }
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((error) => {
        console.error("[Media Audio] release media write lease:", error);
      });
    }
  }
}
