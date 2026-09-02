import { getClientIP, rateLimit } from "@/lib/rateLimit";
import { creditErrorResponse, creditHeaders } from "@/lib/server/credits/api";
import { CreditError } from "@/lib/server/credits/errors";
import { calculateMiniMaxTtsCost } from "@/lib/server/credits/pricing";
import {
  releaseMediaCredits,
  reserveMediaCredits,
  reviewMediaCredits,
  settleMediaCredits,
} from "@/lib/media/server/billing";
import {
  parseJsonRequest,
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";
import { MINIMAX_AUDIO_DEFAULT_MODEL } from "@/lib/media/shared/minimaxAudio";
import { VOICE_PREVIEW_TEXT_ZH } from "@/lib/media/shared/voicePreview";
import {
  listMinimaxSystemVoices,
  synthesizeMinimaxSpeech,
} from "@/lib/media/server/minimaxAudio";
import { downloadAliyunAudio } from "@/lib/media/storage";
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

const PREVIEW_RATE_LIMIT = Object.freeze({ limit: 20, windowMs: 60 * 1000 });
const MAX_JSON_BYTES = 4 * 1024;

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

async function findCustomPreviewVoice({ userId, voiceId }) {
  const custom = await MinimaxVoice.findOne({
    userId,
    voiceId,
    status: "READY",
  }).lean();
  if (custom) {
    return {
      profileId: custom.profileId,
      voiceId: custom.voiceId,
      model: custom.cloneModel || MINIMAX_AUDIO_DEFAULT_MODEL,
      unlockedAt: custom.unlockedAt || null,
    };
  }
  return null;
}

async function resolveSystemPreviewVoice({ voiceId, signal }) {
  const { voices } = await listMinimaxSystemVoices({ signal });
  const system = voices.find((voice) => voice.voiceId === voiceId);
  if (!system) throw Object.assign(new Error("不支持的音色"), { status: 400 });
  return { voiceId: system.voiceId, model: MINIMAX_AUDIO_DEFAULT_MODEL };
}

export async function POST(request) {
  let userId = "";
  let operationId = "";
  let reservation = null;
  let billing = null;
  let billingFinalized = false;
  let requestDispatched = false;
  let upstreamCompleted = false;
  let unlockClaimed = false;
  let chargeFirstVoiceClone = false;
  let unlockProfileId = "";
  let upstreamRequestIds = [];
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    userId = user.userId;
    const limited = rateLimit(
      `media-minimax-audio-preview:${user.userId}:${getClientIP(request)}`,
      PREVIEW_RATE_LIMIT,
    );
    if (!limited.success) return jsonMessage("试听过于频繁，请稍后再试", 429);

    const parsed = await parseJsonRequest(request, "请求内容格式错误", MAX_JSON_BYTES);
    if (!parsed.ok) return parsed.response;
    const voiceId = typeof parsed.body?.voiceId === "string" ? parsed.body.voiceId.trim() : "";
    if (!voiceId) return jsonMessage("请选择音色");

    const creditOperation = requireMediaCreditOperation(request, {
      userId: user.userId,
      feature: "media_audio_minimax_preview",
      fingerprintInput: { voiceId, previewText: VOICE_PREVIEW_TEXT_ZH },
    });
    operationId = creditOperation.operationId;
    await assertMediaCreditOperationUnused({
      operationId,
      userId: user.userId,
      requestFingerprint: creditOperation.requestFingerprint,
    });
    const customVoice = await findCustomPreviewVoice({ userId: user.userId, voiceId });
    let voice = customVoice || { voiceId, model: MINIMAX_AUDIO_DEFAULT_MODEL };
    if (customVoice && !customVoice.unlockedAt) {
      unlockProfileId = customVoice.profileId;
      const unlock = await claimMinimaxVoiceUnlock({
        userId: user.userId,
        profileId: unlockProfileId,
        operationId,
      });
      unlockClaimed = unlock.claimed;
      chargeFirstVoiceClone = unlock.firstVoiceClone;
    }
    const settings = await (await import("@/lib/server/credits/settings")).getBillingSettings();
    try {
      reservation = await reserveMediaCredits({
        operationId,
        userId: user.userId,
        feature: "media_audio_minimax_preview",
        provider: "minimax",
        model: voice.model,
        estimate: calculateMiniMaxTtsCost({
          characters: VOICE_PREVIEW_TEXT_ZH.length,
          quality: billingQuality(voice.model),
          firstVoiceClone: chargeFirstVoiceClone,
        }, settings),
        settings,
        usage: {
          characters: VOICE_PREVIEW_TEXT_ZH.length,
          quality: billingQuality(voice.model),
          firstVoiceClone: chargeFirstVoiceClone,
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
      voice = await resolveSystemPreviewVoice({ voiceId, signal: request.signal });
    }
    const upstream = await synthesizeMinimaxSpeech({
      text: VOICE_PREVIEW_TEXT_ZH,
      model: voice.model,
      voiceId: voice.voiceId,
      speed: 1,
      volume: 1,
      pitch: 0,
      format: "mp3",
      sampleRate: 32000,
    }, {
      signal: request.signal,
      onRequestDispatched: () => {
        requestDispatched = true;
      },
    });
    upstreamCompleted = true;
    upstreamRequestIds = [upstream.requestId, upstream.traceId].filter(Boolean);
    const settled = await settleMediaCredits({
      reservation,
      operationId,
      userId: user.userId,
      actual: calculateMiniMaxTtsCost({
        characters: upstream.characters,
        quality: billingQuality(voice.model),
        firstVoiceClone: chargeFirstVoiceClone,
      }, reservation.settings),
      usage: {
        characters: upstream.characters,
        quality: billingQuality(voice.model),
        firstVoiceClone: chargeFirstVoiceClone,
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
    const audio = await downloadAliyunAudio(upstream.audioUrl, { signal: request.signal });
    return new Response(audio.body, {
      status: 200,
      headers: {
        "Content-Type": audio.headers.get("content-type") || "audio/mpeg",
        "Cache-Control": "private, max-age=300",
        ...creditHeaders(settled.credit),
      },
    });
  } catch (error) {
    if (reservation && !billingFinalized) {
      try {
        const result = upstreamCompleted || (requestDispatched && isAmbiguousSynthesisError(error))
          ? await reviewMediaCredits({
              reservation,
              operationId,
              userId,
              reason: "MiniMax 试听结果不明确",
              usage: {
                characters: VOICE_PREVIEW_TEXT_ZH.length,
                firstVoiceClone: chargeFirstVoiceClone,
              },
              upstreamRequestIds: upstreamRequestIds.length
                ? upstreamRequestIds
                : [error?.requestId, error?.traceId].filter(Boolean),
            })
          : await releaseMediaCredits({
              reservation,
              operationId,
              userId,
              usage: {
                characters: VOICE_PREVIEW_TEXT_ZH.length,
                firstVoiceClone: chargeFirstVoiceClone,
              },
              upstreamRequestIds: [error?.requestId, error?.traceId].filter(Boolean),
            });
        billing = result.billing;
        billingFinalized = true;
      } catch (billingError) {
        console.error("[MiniMax Audio] finalize preview billing:", billingError);
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
        console.error("[MiniMax Audio] release preview unlock claim:", claimError);
      });
    }
    if (error instanceof CreditError) {
      return creditErrorResponse(error, "MiniMax 试听积分处理失败");
    }
    console.error("[MiniMax Audio] preview voice:", error);
    return Response.json(
      {
        success: false,
        message: error?.name === "AbortError" ? "试听已取消" : publicMessage(error, "试听失败"),
        ...(billing ? { billing } : {}),
      },
      { status: error?.name === "AbortError" ? 499 : errorStatus(error) },
    );
  }
}
