import crypto from "node:crypto";
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

async function resolveVoice({ userId, voiceId, signal }) {
  const custom = await MinimaxVoice.findOne({
    userId,
    voiceId,
    status: "READY",
  }).lean();
  if (custom) {
    return { voiceId: custom.voiceId, voiceName: custom.displayName, voiceKind: "custom" };
  }
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

export async function GET() {
  try {
    const auth = await requireUserRecord({ connectDb: true, select: null });
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
  try {
    const auth = await requireUserRecord({ connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    const limited = rateLimit(
      `media-minimax-audio-generation:${user.userId}:${getClientIP(request)}`,
      GENERATION_RATE_LIMIT,
    );
    if (!limited.success) return jsonMessage("语音生成请求过于频繁，请稍后再试", 429);
    const parsed = await parseJsonRequest(request, "请求内容格式错误", MAX_JSON_BYTES);
    if (!parsed.ok) return parsed.response;
    const input = parseInput(parsed.body);
    const voice = await resolveVoice({ userId: user.userId, voiceId: input.voiceId, signal: request.signal });
    mediaWriteLease = await beginMediaWriteLease(user.userId);
    const upstream = await synthesizeMinimaxSpeech({ ...input, voiceId: voice.voiceId }, { signal: request.signal });
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
    }, { status: 201 });
  } catch (error) {
    console.error("[MiniMax Audio] create generation:", {
      error,
      requestId: error?.requestId || "",
      traceId: error?.traceId || "",
    });
    return jsonMessage(publicMessage(error, "MiniMax 语音生成失败"), errorStatus(error));
  } finally {
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((error) => {
        console.error("[MiniMax Audio] release generation lease:", error);
      });
    }
  }
}
