import crypto from "node:crypto";
import { getClientIP, rateLimit } from "@/lib/rateLimit";
import {
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";
import {
  AUDIO_FORMAT_OPTIONS,
  AUDIO_INSTRUCTION_MAX_LENGTH,
  AUDIO_LANGUAGE_HINTS,
  AUDIO_DEFAULT_SAMPLE_RATE,
  AUDIO_MODEL,
  AUDIO_SAMPLE_RATE_OPTIONS,
  AUDIO_TEXT_MAX_LENGTH,
  getPresetAudioVoice,
} from "@/lib/media/shared/models";
import { synthesizeSpeech } from "@/lib/media/server/qwenAudio";
import { serializeAudioGeneration } from "@/lib/media/server/audioRecords";
import {
  assertMediaWriteLeaseActive,
  beginMediaWriteLease,
  endMediaWriteLease,
} from "@/lib/media/server/userOperationLeases";
import { saveAudioFromUrl } from "@/lib/media/storage";
import { deleteStoredFilesByOwner } from "@/lib/server/storage/service";
import AudioGeneration from "@/models/AudioGeneration";
import CustomVoice from "@/models/CustomVoice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GENERATION_RATE_LIMIT = Object.freeze({ limit: 10, windowMs: 60 * 1000 });
const MAX_REQUEST_BYTES = 256 * 1024;
const ALLOWED_FORMATS = new Set(AUDIO_FORMAT_OPTIONS.map((item) => item.id));
const ALLOWED_SAMPLE_RATES = new Set(AUDIO_SAMPLE_RATE_OPTIONS.map((item) => item.id));
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
  return /[\u3400-\u9fff]/u.test(message) ? message : fallback;
}

function readNumber(value, defaultValue) {
  if (value === undefined || value === null || value === "") return defaultValue;
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

async function pruneGenerationHistory(userId) {
  const stale = await AudioGeneration.find({
    userId,
    model: AUDIO_MODEL,
  })
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
    await AudioGeneration.deleteOne({ _id: generation._id, userId });
  }
}

function parseGenerationInput(body) {
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const voiceId = typeof body?.voiceId === "string" ? body.voiceId.trim() : "";
  const instruction = typeof body?.instruction === "string" ? body.instruction.trim() : "";
  const format = typeof body?.format === "string" ? body.format.trim().toLowerCase() : "mp3";
  const sampleRate = readNumber(body?.sampleRate, AUDIO_DEFAULT_SAMPLE_RATE);
  const rate = readNumber(body?.rate, 1);
  const pitch = readNumber(body?.pitch, 1);
  const volume = readNumber(body?.volume, 50);
  const languageHint = typeof body?.languageHint === "string" ? body.languageHint.trim() : "";

  if (!text) throw Object.assign(new Error("请输入需要朗读的文本"), { status: 400 });
  if (text.length > AUDIO_TEXT_MAX_LENGTH) {
    throw Object.assign(new Error(`朗读文本最多支持 ${AUDIO_TEXT_MAX_LENGTH} 个字符`), { status: 400 });
  }
  if (!voiceId) throw Object.assign(new Error("请选择音色"), { status: 400 });
  if (instruction.length > AUDIO_INSTRUCTION_MAX_LENGTH) {
    throw Object.assign(new Error(`表达要求最多支持 ${AUDIO_INSTRUCTION_MAX_LENGTH} 个字符`), { status: 400 });
  }
  if (!ALLOWED_FORMATS.has(format)) {
    throw Object.assign(new Error("不支持的音频格式"), { status: 400 });
  }
  if (!ALLOWED_SAMPLE_RATES.has(sampleRate)) {
    throw Object.assign(new Error("不支持的采样率"), { status: 400 });
  }
  if (!Number.isFinite(rate) || rate < 0.5 || rate > 2) {
    throw Object.assign(new Error("语速必须在 0.5 到 2.0 之间"), { status: 400 });
  }
  if (!Number.isFinite(pitch) || pitch < 0.5 || pitch > 2) {
    throw Object.assign(new Error("音调必须在 0.5 到 2.0 之间"), { status: 400 });
  }
  if (!Number.isInteger(volume) || volume < 0 || volume > 100) {
    throw Object.assign(new Error("音量必须是 0 到 100 之间的整数"), { status: 400 });
  }
  if (languageHint && !ALLOWED_LANGUAGE_HINTS.has(languageHint)) {
    throw Object.assign(new Error("不支持的目标语言"), { status: 400 });
  }

  return {
    text,
    voiceId,
    instruction,
    format,
    sampleRate,
    rate,
    pitch,
    volume,
    languageHint,
  };
}

async function resolveOwnedVoice({ userId, voiceId, languageHint }) {
  const preset = getPresetAudioVoice(voiceId);
  if (preset) {
    if (languageHint && Array.isArray(preset.languages) && !preset.languages.includes(languageHint)) {
      throw Object.assign(new Error("当前音色不支持所选语言"), { status: 400 });
    }
    return { voiceId: preset.id, voiceName: preset.name };
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
    throw Object.assign(new Error("该复刻音色审核未通过，请更换声音样本"), { status: 409 });
  }
  if (custom.status !== "OK" || custom.mutationId || custom.remoteUpdateUncertain) {
    throw Object.assign(new Error("该复刻音色正在审核中，请稍后使用"), { status: 409 });
  }
  return { voiceId: custom.voiceId, voiceName: custom.displayName };
}

export async function GET() {
  try {
    const auth = await requireUserRecord({ connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");

    const generations = await AudioGeneration.find({
      userId: user.userId,
      model: AUDIO_MODEL,
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(100)
      .lean();

    return Response.json({
      success: true,
      generations: generations.map(serializeAudioGeneration).filter(Boolean),
    });
  } catch (error) {
    console.error("[Media Audio] list generations:", error);
    return jsonMessage(getPublicErrorMessage(error, "读取语音记录失败"), getErrorStatus(error));
  }
}

export async function POST(request) {
  let mediaWriteLease = null;
  try {
    const auth = await requireUserRecord({ connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    mediaWriteLease = await beginMediaWriteLease(user.userId);

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_REQUEST_BYTES) {
      return jsonMessage("请求内容过大", 413);
    }

    const clientIP = getClientIP(request);
    const limited = rateLimit(
      `media-audio-generation:${user.userId}:${clientIP}`,
      GENERATION_RATE_LIMIT,
    );
    if (!limited.success) {
      return jsonMessage("语音生成请求过于频繁，请稍后再试", 429);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonMessage("请求体格式错误", 400);
    }
    const input = parseGenerationInput(body);
    const voice = await resolveOwnedVoice({
      userId: user.userId,
      voiceId: input.voiceId,
      languageHint: input.languageHint,
    });

    const upstream = await synthesizeSpeech({
      ...input,
      voiceId: voice.voiceId,
    }, { signal: request.signal });

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
      generation = await AudioGeneration.create({
        generationId,
        userId: user.userId,
        model: AUDIO_MODEL,
        text: input.text,
        voiceId: voice.voiceId,
        voiceName: voice.voiceName,
        instruction: input.instruction,
        format: input.format,
        sampleRate: input.sampleRate,
        rate: input.rate,
        pitch: input.pitch,
        volume: input.volume,
        languageHint: input.languageHint || null,
        characters: upstream.usageCharacters,
        requestId: upstream.requestId,
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

    try {
      await pruneGenerationHistory(user.userId);
    } catch (cleanupError) {
      console.error("[Media Audio] prune generation history:", cleanupError);
    }

    return Response.json({
      success: true,
      generation: serializeAudioGeneration(generation),
    }, { status: 201 });
  } catch (error) {
    console.error("[Media Audio] create generation:", error);
    return jsonMessage(getPublicErrorMessage(error, "语音生成失败"), getErrorStatus(error));
  } finally {
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((leaseError) => {
        console.error("[Media Audio] release media write lease:", leaseError);
      });
    }
  }
}
