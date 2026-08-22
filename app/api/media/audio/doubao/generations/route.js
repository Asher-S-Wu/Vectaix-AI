import crypto from "node:crypto";
import { getClientIP, rateLimit } from "@/lib/rateLimit";
import {
  parseJsonRequest,
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";
import {
  buildDoubaoTextPrompt,
  DOUBAO_AUDIO_DEFAULT_SAMPLE_RATE,
  DOUBAO_AUDIO_FORMAT_IDS,
  DOUBAO_AUDIO_INSTRUCTION_MAX_LENGTH,
  DOUBAO_AUDIO_LOUDNESS_RATE_MAX,
  DOUBAO_AUDIO_LOUDNESS_RATE_MIN,
  DOUBAO_AUDIO_MODEL,
  DOUBAO_AUDIO_PITCH_RATE_MAX,
  DOUBAO_AUDIO_PITCH_RATE_MIN,
  DOUBAO_AUDIO_PROMPT_MAX_LENGTH,
  DOUBAO_AUDIO_REFERENCE_MARKER_PATTERN,
  DOUBAO_AUDIO_SAMPLE_RATE_IDS,
  DOUBAO_AUDIO_SPEECH_RATE_MAX,
  DOUBAO_AUDIO_SPEECH_RATE_MIN,
  DOUBAO_AUDIO_TEXT_MAX_LENGTH,
} from "@/lib/media/shared/doubaoAudio";
import { synthesizeDoubaoSpeech } from "@/lib/media/server/doubaoAudio";
import { serializeDoubaoAudioGeneration } from "@/lib/media/server/doubaoAudioRecords";
import {
  assertMediaWriteLeaseActive,
  beginMediaWriteLease,
  endMediaWriteLease,
} from "@/lib/media/server/userOperationLeases";
import { saveGeneratedAudioBuffer } from "@/lib/media/storage";
import {
  deleteStoredFilesByOwner,
  readStoredFileBuffer,
} from "@/lib/server/storage/service";
import DoubaoAudioGeneration from "@/models/DoubaoAudioGeneration";
import DoubaoVoice from "@/models/DoubaoVoice";
import StoredFile from "@/models/StoredFile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GENERATION_RATE_LIMIT = Object.freeze({ limit: 10, windowMs: 60 * 1000 });
const MAX_JSON_BYTES = 128 * 1024;
const ALLOWED_FORMATS = new Set(DOUBAO_AUDIO_FORMAT_IDS);
const ALLOWED_SAMPLE_RATES = new Set(DOUBAO_AUDIO_SAMPLE_RATE_IDS);

function jsonMessage(message, status = 400) {
  return Response.json({ success: false, message }, { status });
}

function errorStatus(error, fallback = 500) {
  const status = Number(error?.status ?? error?.statusCode);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : fallback;
}

function publicMessage(error, fallback) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("DOUBAO_AUDIO_API_KEY")) return "豆包音频服务密钥尚未配置";
  return /[\u3400-\u9fff]/u.test(message) ? message : fallback;
}

function readNumber(value, defaultValue) {
  if (value === undefined || value === null || value === "") return defaultValue;
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function parseGenerationInput(body) {
  const input = {
    text: typeof body?.text === "string" ? body.text.trim() : "",
    voiceId: typeof body?.voiceId === "string" ? body.voiceId.trim() : "",
    instruction: typeof body?.instruction === "string" ? body.instruction.trim() : "",
    format: typeof body?.format === "string" ? body.format.trim().toLowerCase() : "mp3",
    sampleRate: readNumber(body?.sampleRate, DOUBAO_AUDIO_DEFAULT_SAMPLE_RATE),
    speechRate: readNumber(body?.speechRate, 0),
    loudnessRate: readNumber(body?.loudnessRate, 0),
    pitchRate: readNumber(body?.pitchRate, 0),
  };
  if (!input.text) throw Object.assign(new Error("请输入需要朗读的文字"), { status: 400 });
  if (input.text.length > DOUBAO_AUDIO_TEXT_MAX_LENGTH) {
    throw Object.assign(
      new Error(`朗读文字最多支持 ${DOUBAO_AUDIO_TEXT_MAX_LENGTH} 个字符`),
      { status: 400 },
    );
  }
  if (!input.voiceId) throw Object.assign(new Error("请选择参考声音"), { status: 400 });
  if (input.instruction.length > DOUBAO_AUDIO_INSTRUCTION_MAX_LENGTH) {
    throw Object.assign(
      new Error(`表达要求最多支持 ${DOUBAO_AUDIO_INSTRUCTION_MAX_LENGTH} 个字符`),
      { status: 400 },
    );
  }
  if (
    DOUBAO_AUDIO_REFERENCE_MARKER_PATTERN.test(input.text)
    || DOUBAO_AUDIO_REFERENCE_MARKER_PATTERN.test(input.instruction)
  ) {
    throw Object.assign(new Error("朗读文字和表达要求中不能包含音频引用标记"), { status: 400 });
  }
  if (!ALLOWED_FORMATS.has(input.format)) {
    throw Object.assign(new Error("不支持的音频格式"), { status: 400 });
  }
  if (!ALLOWED_SAMPLE_RATES.has(input.sampleRate)) {
    throw Object.assign(new Error("不支持的采样率"), { status: 400 });
  }
  if (
    !Number.isInteger(input.speechRate)
    || input.speechRate < DOUBAO_AUDIO_SPEECH_RATE_MIN
    || input.speechRate > DOUBAO_AUDIO_SPEECH_RATE_MAX
  ) {
    throw Object.assign(
      new Error(`语速必须是 ${DOUBAO_AUDIO_SPEECH_RATE_MIN} 到 ${DOUBAO_AUDIO_SPEECH_RATE_MAX} 之间的整数`),
      { status: 400 },
    );
  }
  if (
    !Number.isInteger(input.loudnessRate)
    || input.loudnessRate < DOUBAO_AUDIO_LOUDNESS_RATE_MIN
    || input.loudnessRate > DOUBAO_AUDIO_LOUDNESS_RATE_MAX
  ) {
    throw Object.assign(
      new Error(`响度必须是 ${DOUBAO_AUDIO_LOUDNESS_RATE_MIN} 到 ${DOUBAO_AUDIO_LOUDNESS_RATE_MAX} 之间的整数`),
      { status: 400 },
    );
  }
  if (
    !Number.isInteger(input.pitchRate)
    || input.pitchRate < DOUBAO_AUDIO_PITCH_RATE_MIN
    || input.pitchRate > DOUBAO_AUDIO_PITCH_RATE_MAX
  ) {
    throw Object.assign(
      new Error(`音高必须是 ${DOUBAO_AUDIO_PITCH_RATE_MIN} 到 ${DOUBAO_AUDIO_PITCH_RATE_MAX} 之间的整数`),
      { status: 400 },
    );
  }
  const textPrompt = buildDoubaoTextPrompt(input);
  if (textPrompt.length > DOUBAO_AUDIO_PROMPT_MAX_LENGTH) {
    throw Object.assign(
      new Error(`发送给豆包的完整内容最多支持 ${DOUBAO_AUDIO_PROMPT_MAX_LENGTH} 个字符`),
      { status: 400 },
    );
  }
  return { ...input, textPrompt };
}

async function resolveOwnedVoiceReference({ userId, profileId }) {
  const voice = await DoubaoVoice.findOne({
    userId,
    profileId,
    model: DOUBAO_AUDIO_MODEL,
    status: "READY",
  }).lean();
  if (!voice) throw Object.assign(new Error("豆包参考声音不存在"), { status: 404 });
  const file = await StoredFile.findOne({
    userId,
    fileId: voice.sampleFileId,
    kind: "doubao-voice-reference",
    ownerType: "voice-profile",
    ownerId: voice.profileId,
  });
  if (!file) {
    throw Object.assign(new Error("豆包参考声音文件不存在"), { status: 409 });
  }
  const buffer = await readStoredFileBuffer(file);
  if (buffer.length !== Number(voice.size)) {
    throw Object.assign(new Error("豆包参考声音文件不完整"), { status: 409 });
  }
  return { voice, file, buffer };
}

async function assertVoiceStillReady({ userId, voice, file }) {
  const exists = await DoubaoVoice.exists({
    userId,
    profileId: voice.profileId,
    model: DOUBAO_AUDIO_MODEL,
    status: "READY",
    sampleFileId: file.fileId,
  });
  if (!exists) {
    throw Object.assign(new Error("豆包参考声音已被删除，本次结果未保存"), { status: 409 });
  }
}

async function pruneHistory(userId) {
  const stale = await DoubaoAudioGeneration.find({
    userId,
    model: DOUBAO_AUDIO_MODEL,
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
    await DoubaoAudioGeneration.deleteOne({
      _id: generation._id,
      userId,
      model: DOUBAO_AUDIO_MODEL,
    });
  }
}

export async function GET() {
  try {
    const auth = await requireUserRecord({ connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    const generations = await DoubaoAudioGeneration.find({
      userId: user.userId,
      model: DOUBAO_AUDIO_MODEL,
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(100)
      .lean();
    return Response.json({
      success: true,
      generations: generations.map(serializeDoubaoAudioGeneration).filter(Boolean),
    });
  } catch (error) {
    console.error("[Doubao Audio] list generations:", error);
    return jsonMessage(publicMessage(error, "读取豆包语音记录失败"), errorStatus(error));
  }
}

export async function POST(request) {
  let mediaWriteLease = null;
  try {
    const auth = await requireUserRecord({ connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    const limited = rateLimit(
      `media-doubao-audio-generation:${user.userId}:${getClientIP(request)}`,
      GENERATION_RATE_LIMIT,
    );
    if (!limited.success) return jsonMessage("语音生成请求过于频繁，请稍后再试", 429);
    const parsed = await parseJsonRequest(request, "请求内容格式错误", MAX_JSON_BYTES);
    if (!parsed.ok) {
      return parsed.response.status === 413
        ? jsonMessage("请求内容过大", 413)
        : parsed.response;
    }
    const input = parseGenerationInput(parsed.body);
    const reference = await resolveOwnedVoiceReference({
      userId: user.userId,
      profileId: input.voiceId,
    });

    mediaWriteLease = await beginMediaWriteLease(user.userId);
    const upstream = await synthesizeDoubaoSpeech({
      textPrompt: input.textPrompt,
      referenceAudioBase64: reference.buffer.toString("base64"),
      format: input.format,
      sampleRate: input.sampleRate,
      speechRate: input.speechRate,
      loudnessRate: input.loudnessRate,
      pitchRate: input.pitchRate,
    }, { signal: request.signal });
    await assertVoiceStillReady({ userId: user.userId, ...reference });

    const generationId = crypto.randomUUID();
    let generation;
    try {
      await assertMediaWriteLeaseActive(mediaWriteLease);
      const saved = await saveGeneratedAudioBuffer({
        userId: user.userId,
        input: upstream.audioBuffer,
        mimeType: upstream.mimeType,
        ownerId: generationId,
        mediaWriteLease,
      });
      await assertMediaWriteLeaseActive(mediaWriteLease);
      generation = await DoubaoAudioGeneration.create({
        generationId,
        userId: user.userId,
        model: DOUBAO_AUDIO_MODEL,
        text: input.text,
        voiceId: reference.voice.profileId,
        profileId: reference.voice.profileId,
        voiceName: reference.voice.displayName,
        instruction: input.instruction,
        format: input.format,
        sampleRate: input.sampleRate,
        speechRate: input.speechRate,
        loudnessRate: input.loudnessRate,
        pitchRate: input.pitchRate,
        duration: upstream.duration,
        originalDuration: upstream.originalDuration,
        requestId: upstream.requestId,
        upstreamLogId: upstream.upstreamLogId,
        referenceFileId: reference.file.fileId,
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
      await pruneHistory(user.userId);
    } catch (cleanupError) {
      console.error("[Doubao Audio] prune generation history:", cleanupError);
    }
    return Response.json({
      success: true,
      generation: serializeDoubaoAudioGeneration(generation),
    }, { status: 201 });
  } catch (error) {
    console.error("[Doubao Audio] create generation:", {
      error,
      requestId: error?.requestId || "",
      upstreamLogId: error?.upstreamLogId || "",
    });
    return jsonMessage(publicMessage(error, "豆包语音生成失败"), errorStatus(error));
  } finally {
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((error) => {
        console.error("[Doubao Audio] release generation lease:", error);
      });
    }
  }
}
