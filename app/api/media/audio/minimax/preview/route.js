import { getClientIP, rateLimit } from "@/lib/rateLimit";
import {
  parseJsonRequest,
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";
import {
  MINIMAX_AUDIO_DEFAULT_MODEL,
  MINIMAX_AUDIO_MODEL_IDS,
} from "@/lib/media/shared/minimaxAudio";
import { modelAccessResponse } from "@/lib/server/guest/access";
import { VOICE_PREVIEW_TEXT_ZH } from "@/lib/media/shared/voicePreview";
import {
  listMinimaxSystemVoices,
  synthesizeMinimaxSpeech,
} from "@/lib/media/server/minimaxAudio";
import { downloadAliyunAudio } from "@/lib/media/storage";
import MinimaxVoice from "@/models/MinimaxVoice";

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

async function resolvePreviewVoice({ userId, voiceId, signal }) {
  const custom = await MinimaxVoice.findOne({
    userId,
    voiceId,
    status: "READY",
  }).lean();
  if (custom) {
    return { voiceId: custom.voiceId, model: custom.cloneModel || MINIMAX_AUDIO_DEFAULT_MODEL };
  }
  const { voices } = await listMinimaxSystemVoices({ signal });
  const system = voices.find((voice) => voice.voiceId === voiceId);
  if (!system) throw Object.assign(new Error("不支持的音色"), { status: 400 });
  return { voiceId: system.voiceId, model: MINIMAX_AUDIO_DEFAULT_MODEL };
}

export async function POST(request) {
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    const limited = rateLimit(
      `media-minimax-audio-preview:${user.userId}:${getClientIP(request)}`,
      PREVIEW_RATE_LIMIT,
    );
    if (!limited.success) return jsonMessage("试听过于频繁，请稍后再试", 429);

    const parsed = await parseJsonRequest(request, "请求内容格式错误", MAX_JSON_BYTES);
    if (!parsed.ok) return parsed.response;
    const voiceId = typeof parsed.body?.voiceId === "string" ? parsed.body.voiceId.trim() : "";
    if (!voiceId) return jsonMessage("请选择音色");
    const requestedModel = typeof parsed.body?.model === "string" ? parsed.body.model.trim() : "";
    if (user.kind === "guest") {
      if (!MINIMAX_AUDIO_MODEL_IDS.includes(requestedModel)) {
        return jsonMessage("请选择要试听的 MiniMax 模型");
      }
      const accessError = modelAccessResponse(user, requestedModel);
      if (accessError) return accessError;
    }

    const voice = await resolvePreviewVoice({
      userId: user.userId,
      voiceId,
      signal: request.signal,
    });
    const upstream = await synthesizeMinimaxSpeech({
      text: VOICE_PREVIEW_TEXT_ZH,
      model: user.kind === "guest" ? requestedModel : voice.model,
      voiceId: voice.voiceId,
      speed: 1,
      volume: 1,
      pitch: 0,
      format: "mp3",
      sampleRate: 32000,
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
    console.error("[MiniMax Audio] preview voice:", error);
    return jsonMessage(publicMessage(error, "试听失败"), errorStatus(error));
  }
}
