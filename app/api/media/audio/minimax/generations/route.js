import crypto from "node:crypto";
import { creditErrorResponse } from "@/lib/server/credits/api";
import { CreditError } from "@/lib/server/credits/errors";
import { calculateMiniMaxTtsCost } from "@/lib/server/credits/pricing";
import {
  releaseMediaCredits,
  reserveMediaCredits,
  reviewMediaCredits,
  settleMediaCredits,
} from "@/lib/media/server/billing";
import { getClientIP, rateLimit } from "@/lib/rateLimit";
import {
  parseJsonRequest,
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";
import {
  MINIMAX_AUDIO_EMOTION_IDS,
  MINIMAX_AUDIO_DEFAULT_SAMPLE_RATE,
  MINIMAX_AUDIO_FORMAT_IDS,
  MINIMAX_AUDIO_LANGUAGE_IDS,
  MINIMAX_AUDIO_MODEL_IDS,
  MINIMAX_AUDIO_SAMPLE_RATE_IDS,
  MINIMAX_AUDIO_TEXT_MAX_LENGTH,
} from "@/lib/media/shared/minimaxAudio";
import {
  listMinimaxSystemVoices,
  synthesizeMinimaxSpeech,
} from "@/lib/media/server/minimaxAudio";
import { serializeMinimaxAudioGeneration } from "@/lib/media/server/minimaxAudioRecords";
import {
  assertMediaWriteLeaseActive,
  beginMediaWriteLease,
  endMediaWriteLease,
} from "@/lib/media/server/userOperationLeases";
import { saveAudioFromUrl } from "@/lib/media/storage";
import { deleteStoredFilesByOwner } from "@/lib/server/storage/service";
import MinimaxAudioGeneration from "@/models/MinimaxAudioGeneration";
import MinimaxVoice from "@/models/MinimaxVoice";
import {
  claimMinimaxVoiceUnlock,
  completeMinimaxVoiceUnlockClaim,
  releaseMinimaxVoiceUnlockClaim,
} from "@/lib/media/server/minimaxUnlockClaims";
import {
  assertMediaCreditOperationUnused,
  requireMediaCreditOperation,
} from "@/lib/media/server/creditOperation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GENERATION_RATE_LIMIT = Object.freeze({ limit: 10, windowMs: 60 * 1000 });
const MAX_JSON_BYTES = 128 * 1024;
const ALLOWED_MODELS = new Set(MINIMAX_AUDIO_MODEL_IDS);
const ALLOWED_EMOTIONS = new Set(MINIMAX_AUDIO_EMOTION_IDS.filter(Boolean));
const ALLOWED_LANGUAGES = new Set(MINIMAX_AUDIO_LANGUAGE_IDS.filter(Boolean));
const ALLOWED_FORMATS = new Set(MINIMAX_AUDIO_FORMAT_IDS);
const ALLOWED_SAMPLE_RATES = new Set(MINIMAX_AUDIO_SAMPLE_RATE_IDS);

function jsonMessage(message, status = 400) {
  return Response.json({ success: false, message }, { status });
}

function errorStatus(error, fallback = 500) {
  const status = Number(error?.status ?? error?.statusCode);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : fallback;
}

function publicMessage(error, fallback) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("DASHSCOPE_BEIJING_API_KEY")) return "MiniMax 北京区域密钥尚未配置";
  return /[\u3400-\u9fff]/u.test(message) ? message : fallback;
}

function billingQuality(model) {
  return model.endsWith("-turbo") ? "turbo" : "hd";
}

function isAmbiguousSynthesisError(error) {
  return error?.name === "AbortError"
    || ["NETWORK_ERROR", "INVALID_RESPONSE", "INVALID_USAGE", "MISSING_AUDIO"].includes(String(error?.code || ""));
}

function readNumber(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function parseInput(body) {
  const input = {
    text: typeof body?.text === "string" ? body.text.trim() : "",
    model: typeof body?.model === "string" ? body.model.trim() : "",
    voiceId: typeof body?.voiceId === "string" ? body.voiceId.trim() : "",
    emotion: typeof body?.emotion === "string" && body.emotion.trim() ? body.emotion.trim() : null,
    speed: readNumber(body?.speed, 1),
    volume: readNumber(body?.volume, 1),
    pitch: readNumber(body?.pitch, 0),
    languageBoost: typeof body?.languageBoost === "string" && body.languageBoost.trim() ? body.languageBoost.trim() : null,
    format: typeof body?.format === "string" ? body.format.trim().toLowerCase() : "mp3",
    sampleRate: readNumber(body?.sampleRate, MINIMAX_AUDIO_DEFAULT_SAMPLE_RATE),
  };
  if (!input.text) throw Object.assign(new Error("请输入需要朗读的文字"), { status: 400 });
  if (input.text.length > MINIMAX_AUDIO_TEXT_MAX_LENGTH) {
    throw Object.assign(new Error(`朗读文字最多支持 ${MINIMAX_AUDIO_TEXT_MAX_LENGTH} 个字符`), { status: 400 });
  }
  if (!ALLOWED_MODELS.has(input.model)) throw Object.assign(new Error("不支持的 MiniMax 模型"), { status: 400 });
  if (!input.voiceId) throw Object.assign(new Error("请选择音色"), { status: 400 });
  if (input.emotion !== null && !ALLOWED_EMOTIONS.has(input.emotion)) {
    throw Object.assign(new Error("不支持的情感"), { status: 400 });
  }
  if (!Number.isFinite(input.speed) || input.speed < 0.5 || input.speed > 2) {
    throw Object.assign(new Error("语速必须在 0.5 到 2.0 之间"), { status: 400 });
  }
  if (!Number.isFinite(input.volume) || input.volume < 0.1 || input.volume > 10) {
    throw Object.assign(new Error("音量必须在 0.1 到 10.0 之间"), { status: 400 });
  }
  if (!Number.isInteger(input.pitch) || input.pitch < -12 || input.pitch > 12) {
    throw Object.assign(new Error("音高必须是 -12 到 12 之间的整数"), { status: 400 });
  }
  if (input.languageBoost !== null && !ALLOWED_LANGUAGES.has(input.languageBoost)) {
    throw Object.assign(new Error("不支持的语言增强选项"), { status: 400 });
  }
  if (!ALLOWED_FORMATS.has(input.format)) throw Object.assign(new Error("不支持的音频格式"), { status: 400 });
  if (!ALLOWED_SAMPLE_RATES.has(input.sampleRate)) throw Object.assign(new Error("不支持的采样率"), { status: 400 });
  return input;
}

async function findCustomVoice({ userId, voiceId }) {
  const custom = await MinimaxVoice.findOne({
    userId,
    voiceId,
    status: "READY",
  }).lean();
  if (custom) {
    return {
      profileId: custom.profileId,
      voiceId: custom.voiceId,
      voiceName: custom.displayName,
      voiceKind: "custom",
      unlockedAt: custom.unlockedAt || null,
    };
  }
  return null;
}

async function resolveSystemVoice({ voiceId, signal }) {
  const { voices } = await listMinimaxSystemVoices({ signal });
  const system = voices.find((voice) => voice.voiceId === voiceId);
  if (!system) throw Object.assign(new Error("不支持的音色"), { status: 400 });
  return { voiceId: system.voiceId, voiceName: system.name, voiceKind: "system" };
}

async function pruneHistory(userId) {
  const stale = await MinimaxAudioGeneration.find({ userId })
    .sort({ createdAt: -1, _id: -1 })
    .skip(100)
    .select("_id generationId")
    .lean();
  for (const generation of stale) {
    await deleteStoredFilesByOwner({
      userId,
      ownerType: "audio-generation",
      ownerId: generation.generationId,
    });
    await MinimaxAudioGeneration.deleteOne({ _id: generation._id, userId });
  }
}

export async function GET(request) {
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    const generations = await MinimaxAudioGeneration.find({ userId: user.userId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(100)
      .lean();
    return Response.json({
      success: true,
      generations: generations.map(serializeMinimaxAudioGeneration).filter(Boolean),
    });
  } catch (error) {
    console.error("[MiniMax Audio] list generations:", error);
    return jsonMessage(publicMessage(error, "读取 MiniMax 语音记录失败"), errorStatus(error));
  }
}

export async function POST(request) {
  let mediaWriteLease = null;
  let userId = "";
  let operationId = "";
  let reservation = null;
  let billing = null;
  let billingFinalized = false;
  let unlockClaimed = false;
  let chargeFirstVoiceClone = false;
  let upstreamCompleted = false;
  let requestDispatched = false;
  let upstreamRequestIds = [];
  let unlockProfileId = "";
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    userId = user.userId;
    const limited = rateLimit(
      `media-minimax-audio-generation:${user.userId}:${getClientIP(request)}`,
      GENERATION_RATE_LIMIT,
    );
    if (!limited.success) return jsonMessage("语音生成请求过于频繁，请稍后再试", 429);
    const parsed = await parseJsonRequest(request, "请求内容格式错误", MAX_JSON_BYTES);
    if (!parsed.ok) return parsed.response;
    const input = parseInput(parsed.body);
    const creditOperation = requireMediaCreditOperation(request, {
      userId: user.userId,
      feature: "media_audio_minimax_generation",
      fingerprintInput: input,
    });
    operationId = creditOperation.operationId;
    await assertMediaCreditOperationUnused({
      operationId,
      userId: user.userId,
      requestFingerprint: creditOperation.requestFingerprint,
    });
    const customVoice = await findCustomVoice({ userId: user.userId, voiceId: input.voiceId });
    let voice = customVoice || {
      voiceId: input.voiceId,
      voiceName: "系统音色",
      voiceKind: "system",
      unlockedAt: null,
    };
    if (voice.voiceKind === "custom" && !voice.unlockedAt) {
      unlockProfileId = voice.profileId;
      const unlock = await claimMinimaxVoiceUnlock({
        userId: user.userId,
        profileId: voice.profileId,
        operationId,
      });
      unlockClaimed = unlock.claimed;
      chargeFirstVoiceClone = unlock.firstVoiceClone;
    }
    try {
      const settings = await (await import("@/lib/server/credits/settings")).getBillingSettings();
      reservation = await reserveMediaCredits({
        operationId,
        userId: user.userId,
        feature: "media_audio_minimax_generation",
        provider: "minimax",
        model: input.model,
        estimate: calculateMiniMaxTtsCost({
          characters: input.text.length,
          quality: billingQuality(input.model),
          firstVoiceClone: chargeFirstVoiceClone,
        }, settings),
        settings,
        usage: {
          characters: input.text.length,
          quality: billingQuality(input.model),
          firstVoiceClone: chargeFirstVoiceClone,
          voiceKind: voice.voiceKind,
          voiceId: voice.voiceId,
        },
        executionClaimId: creditOperation.executionClaimId,
        requestFingerprint: creditOperation.requestFingerprint,
      });
    } catch (error) {
      if (unlockClaimed) {
        await releaseMinimaxVoiceUnlockClaim({
          userId: user.userId,
          profileId: unlockProfileId,
          operationId,
        }).catch(() => {});
        unlockClaimed = false;
      }
      throw error;
    }
    if (!customVoice) {
      voice = await resolveSystemVoice({ voiceId: input.voiceId, signal: request.signal });
    }
    mediaWriteLease = await beginMediaWriteLease(user.userId);
    await assertMediaWriteLeaseActive(mediaWriteLease);
    const upstream = await synthesizeMinimaxSpeech(
      { ...input, voiceId: voice.voiceId },
      {
        signal: request.signal,
        onRequestDispatched: () => {
          requestDispatched = true;
        },
      },
    );
    upstreamCompleted = true;
    upstreamRequestIds = [upstream.requestId, upstream.traceId].filter(Boolean);
    const settled = await settleMediaCredits({
      reservation,
      operationId,
      userId: user.userId,
      actual: calculateMiniMaxTtsCost({
        characters: upstream.characters,
        quality: billingQuality(input.model),
        firstVoiceClone: chargeFirstVoiceClone,
      }, reservation.settings),
      usage: {
        characters: upstream.characters,
        quality: billingQuality(input.model),
        firstVoiceClone: chargeFirstVoiceClone,
        voiceKind: voice.voiceKind,
        voiceId: voice.voiceId,
      },
      upstreamRequestIds,
    });
    billing = settled.billing;
    billingFinalized = true;
    if (unlockClaimed && ["settled", "released"].includes(settled.transaction?.status)) {
      const unlocked = await completeMinimaxVoiceUnlockClaim({
        userId: user.userId,
        profileId: unlockProfileId,
        operationId,
      });
      if (!unlocked) throw new Error("保存自定义音色首次解锁状态失败");
      unlockClaimed = false;
    }
    const generationId = crypto.randomUUID();
    let generation;
    try {
      await assertMediaWriteLeaseActive(mediaWriteLease);
      const saved = await saveAudioFromUrl({
        userId: user.userId,
        url: upstream.audioUrl,
        format: input.format,
        ownerId: generationId,
        signal: request.signal,
        mediaWriteLease,
      });
      await assertMediaWriteLeaseActive(mediaWriteLease);
      generation = await MinimaxAudioGeneration.create({
        generationId,
        userId: user.userId,
        ...input,
        ...voice,
        characters: upstream.characters,
        durationMs: upstream.durationMs,
        requestId: upstream.requestId,
        traceId: upstream.traceId,
        audioFileId: saved.fileId,
      });
    } catch (error) {
      await deleteStoredFilesByOwner({
        userId: user.userId,
        ownerType: "audio-generation",
        ownerId: generationId,
      });
      throw error;
    }
    await pruneHistory(user.userId);
    return Response.json({
      success: true,
      generation: serializeMinimaxAudioGeneration(generation),
      billing,
    }, { status: 201 });
  } catch (error) {
    if (reservation && !billingFinalized) {
      try {
        const result = upstreamCompleted || (requestDispatched && isAmbiguousSynthesisError(error))
          ? await reviewMediaCredits({
              reservation,
              operationId,
              userId,
              reason: upstreamCompleted
                ? "MiniMax 已完成生成但本地解锁或结算状态异常"
                : "MiniMax 语音生成结果不明确",
              usage: { upstreamCompleted },
              upstreamRequestIds: upstreamRequestIds.length
                ? upstreamRequestIds
                : [error?.requestId, error?.traceId].filter(Boolean),
            })
          : await releaseMediaCredits({
              reservation,
              operationId,
              userId,
              usage: { failedBeforeCompletion: true },
              upstreamRequestIds: [error?.requestId, error?.traceId].filter(Boolean),
            });
        billing = result.billing;
        billingFinalized = true;
      } catch (billingError) {
        console.error("[MiniMax Audio] finalize generation billing:", billingError);
      }
    }
    if (
      unlockClaimed
      && !upstreamCompleted
      && (!requestDispatched || !isAmbiguousSynthesisError(error))
    ) {
      await releaseMinimaxVoiceUnlockClaim({
        userId,
        profileId: unlockProfileId,
        operationId,
      }).catch((claimError) => {
        console.error("[MiniMax Audio] release first unlock claim:", claimError);
      });
    }
    console.error("[MiniMax Audio] create generation:", {
      error,
      requestId: error?.requestId || "",
      traceId: error?.traceId || "",
    });
    if (error instanceof CreditError) {
      return creditErrorResponse(error, "MiniMax 语音生成积分处理失败");
    }
    return Response.json(
      {
        success: false,
        message: publicMessage(error, "MiniMax 语音生成失败"),
        ...(billing ? { billing } : {}),
      },
      { status: errorStatus(error) },
    );
  } finally {
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((error) => {
        console.error("[MiniMax Audio] release generation lease:", error);
      });
    }
  }
}
