import { getClientIP, rateLimit } from "@/lib/rateLimit";
import {
  parseJsonRequest,
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";
import { AUDIO_MODEL, getPresetAudioVoice } from "@/lib/media/shared/models";
import { getVoicePreviewText } from "@/lib/media/shared/voicePreview";
import { synthesizeSpeech } from "@/lib/media/server/qwenAudio";
import { downloadAliyunAudio } from "@/lib/media/storage";
import CustomVoice from "@/models/CustomVoice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PREVIEW_RATE_LIMIT = Object.freeze({ limit: 20, windowMs: 60 * 1000 });
const MAX_JSON_BYTES = 4 * 1024;

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
  return /[\u3400-\u9fff]/u.test(message) ? message : fallback;
}

async function resolvePreviewVoice({ userId, voiceId }) {
  const preset = getPresetAudioVoice(voiceId);
  if (preset) {
    return {
      voiceId: preset.id,
      languageHint: Array.isArray(preset.languages) && preset.languages.includes("zh")
        ? "zh"
        : (preset.languages?.[0] || "zh"),
      languages: preset.languages,
    };
  }

  const custom = await CustomVoice.findOne({
    userId,
    voiceId,
    model: AUDIO_MODEL,
  }).select("+mutationId +remoteUpdateUncertain").lean();
  if (!custom) {
    throw Object.assign(new Error("不支持的音色"), { status: 400 });
  }
  if (custom.status === "UNDEPLOYED") {
    throw Object.assign(new Error("该复刻音色审核未通过，暂时不能试听"), { status: 409 });
  }
  if (custom.status !== "OK" || custom.mutationId || custom.remoteUpdateUncertain) {
    throw Object.assign(new Error("该复刻音色还不能试听"), { status: 409 });
  }
  return {
    voiceId: custom.voiceId,
    languageHint: custom.languageHint || "zh",
    languages: custom.languageHint ? [custom.languageHint] : ["zh"],
  };
}

export async function POST(request) {
  try {
    const auth = await requireUserRecord({ connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    const limited = rateLimit(
      `media-audio-preview:${user.userId}:${getClientIP(request)}`,
      PREVIEW_RATE_LIMIT,
    );
    if (!limited.success) return jsonMessage("试听过于频繁，请稍后再试", 429);

    const parsed = await parseJsonRequest(request, "请求内容格式错误", MAX_JSON_BYTES);
    if (!parsed.ok) return parsed.response;
    const voiceId = typeof parsed.body?.voiceId === "string" ? parsed.body.voiceId.trim() : "";
    if (!voiceId) return jsonMessage("请选择音色");

    const voice = await resolvePreviewVoice({ userId: user.userId, voiceId });
    const upstream = await synthesizeSpeech({
      text: getVoicePreviewText(voice.languages),
      voiceId: voice.voiceId,
      format: "mp3",
      sampleRate: 24000,
      languageHint: voice.languageHint,
    }, { signal: request.signal });
    const audio = await downloadAliyunAudio(upstream.audioUrl, { signal: request.signal });
    return new Response(audio.body, {
      status: 200,
      headers: {
        "Content-Type": audio.headers.get("content-type") || "audio/mpeg",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      return jsonMessage("试听已取消", 499);
    }
    console.error("[Media Audio] preview voice:", error);
    return jsonMessage(getPublicErrorMessage(error, "试听失败"), getErrorStatus(error));
  }
}
