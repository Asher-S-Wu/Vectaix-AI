import crypto from "node:crypto";
import { getClientIP, rateLimit } from "@/lib/rateLimit";
import {
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
import { inspectVoiceSample } from "@/lib/media/server/audioSampleInspection";
import { cleanupExpiredVoiceSamples } from "@/lib/media/server/voiceSampleCleanup";
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
const SAMPLE_MAX_BYTES = 10 * 1024 * 1024;
const MULTIPART_MAX_BYTES = SAMPLE_MAX_BYTES + 1024 * 1024;
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
  if (message.includes("DASHSCOPE_API_KEY")) {
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

function getFileExtension(name) {
  const match = /\.([a-z0-9]+)$/i.exec(String(name || "").trim());
  return match ? match[1].toLowerCase() : "";
}

function inspectUploadedSample(buffer, extension) {
  try {
    return inspectVoiceSample(buffer, extension);
  } catch (error) {
    if (error instanceof Error) error.status = 400;
    throw error;
  }
}

function readCreateVoiceForm(formData) {
  const displayName = typeof formData.get("displayName") === "string"
    ? formData.get("displayName").trim()
    : "";
  const languageHint = typeof formData.get("languageHint") === "string"
    ? formData.get("languageHint").trim()
    : "zh";
  const enablePreprocess = formData.get("enablePreprocess") === "true";
  const consent = formData.get("consent") === "true";
  const audio = formData.get("audio");

  if (!displayName || displayName.length > 40) {
    throw Object.assign(new Error("音色名称需为 1 到 40 个字符"), { status: 400 });
  }
  if (!ALLOWED_LANGUAGE_HINTS.has(languageHint)) {
    throw Object.assign(new Error("不支持的样本语言"), { status: 400 });
  }
  if (!consent) {
    throw Object.assign(new Error("请先确认已获得声音使用授权"), { status: 400 });
  }
  if (!(audio instanceof File) || audio.size <= 0) {
    throw Object.assign(new Error("请选择声音样本"), { status: 400 });
  }
  if (audio.size > SAMPLE_MAX_BYTES) {
    throw Object.assign(new Error("声音样本不能超过 10MB"), { status: 413 });
  }

  return {
    displayName,
    languageHint,
    enablePreprocess,
    audio,
  };
}

export async function GET() {
  let mediaWriteLease = null;
  try {
    const auth = await requireUserRecord({ connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    mediaWriteLease = await beginMediaWriteLease(user.userId);

    await assertMediaWriteLeaseActive(mediaWriteLease);
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
  try {
    const auth = await requireUserRecord({ connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    userId = user.userId;
    mediaWriteLease = await beginMediaWriteLease(user.userId);
    voiceCreationLease = await acquireVoiceCreationLease(user.userId);

    const rawContentLength = request.headers.get("content-length");
    if (!rawContentLength || !/^\d+$/.test(rawContentLength)) {
      return jsonMessage("上传请求缺少有效的大小信息", 411);
    }
    const contentLength = Number(rawContentLength);
    if (contentLength > MULTIPART_MAX_BYTES) {
      return jsonMessage("上传内容不能超过 11MB", 413);
    }

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

    let formData;
    try {
      formData = await request.formData();
    } catch {
      return jsonMessage("上传内容格式错误", 400);
    }
    const input = readCreateVoiceForm(formData);
    const extension = getFileExtension(input.audio.name);
    const buffer = Buffer.from(await input.audio.arrayBuffer());
    const inspected = inspectUploadedSample(buffer, extension);

    profileId = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString("base64url");
    const now = Date.now();
    const sampleTokenExpiresAt = new Date(now + SAMPLE_TOKEN_TTL_MS);
    const sampleExpiresAt = new Date(now + SAMPLE_FILE_TTL_MS);
    const prefix = createVoicePrefix();
    await assertMediaWriteLeaseActive(mediaWriteLease);
    const saved = await createStoredFile({
      userId: user.userId,
      input: buffer,
      originalName: input.audio.name,
      mimeType: inspected.mimeType,
      extension: inspected.extension,
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
        sampleFileName: input.audio.name,
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
