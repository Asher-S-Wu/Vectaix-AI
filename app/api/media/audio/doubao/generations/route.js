import crypto from "node:crypto";
import { getClientIP, rateLimit } from "@/lib/rateLimit";
import { getFileExtension } from "@/lib/shared/attachments";
import {
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";
import {
  DOUBAO_AUDIO_FORMAT_IDS,
  DOUBAO_AUDIO_MODE_IDS,
  DOUBAO_AUDIO_MODEL,
  DOUBAO_AUDIO_REFERENCE_MAX_COUNT,
  DOUBAO_AUDIO_TEXT_MAX_LENGTH,
} from "@/lib/media/shared/doubaoAudio";
import { inspectDoubaoReferenceAudio } from "@/lib/media/server/doubaoAudioReferenceInspection";
import { generateDoubaoAudio } from "@/lib/media/server/doubaoAudio";
import { serializeDoubaoAudioGeneration } from "@/lib/media/server/doubaoAudioRecords";
import {
  assertMediaWriteLeaseActive,
  beginMediaWriteLease,
  endMediaWriteLease,
} from "@/lib/media/server/userOperationLeases";
import { saveGeneratedAudioBuffer } from "@/lib/media/storage";
import { deleteStoredFilesByOwner } from "@/lib/server/storage/service";
import DoubaoAudioGeneration from "@/models/DoubaoAudioGeneration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GENERATION_RATE_LIMIT = Object.freeze({ limit: 10, windowMs: 60 * 1000 });
const MAX_REQUEST_BYTES = 32 * 1024 * 1024;
const MODE_SET = new Set(DOUBAO_AUDIO_MODE_IDS);
const FORMAT_SET = new Set(DOUBAO_AUDIO_FORMAT_IDS);

function jsonMessage(message, status = 400) {
  return Response.json({ success: false, message }, { status });
}

function getErrorStatus(error, fallback = 500) {
  const status = Number(error?.status);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : fallback;
}

function publicMessage(error, fallback) {
  const message = error instanceof Error ? error.message : "";
  return /[\u3400-\u9fff]/u.test(message) ? message : fallback;
}

function readInteger(value, label, min, max, defaultValue) {
  const normalized = String(value ?? "").trim();
  if (!normalized && defaultValue !== undefined) return defaultValue;
  if (!/^-?\d+$/.test(normalized)) {
    throw Object.assign(new Error(`${label}必须是整数`), { status: 400 });
  }
  const number = Number(normalized);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw Object.assign(new Error(`${label}不在允许范围内`), { status: 400 });
  }
  return number;
}

function readBoolean(value, label) {
  const normalized = String(value ?? "false").trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw Object.assign(new Error(`${label}参数无效`), { status: 400 });
}

function getFormDataSize(formData) {
  let size = 0;
  for (const [, value] of formData.entries()) {
    size += value instanceof File ? value.size : Buffer.byteLength(String(value), "utf8");
    if (size > MAX_REQUEST_BYTES) return size;
  }
  return size;
}

function validateAudioReferencesInPrompt(textPrompt, referenceCount) {
  for (const match of textPrompt.matchAll(/@音频(\d+)/gu)) {
    const number = Number(match[1]);
    if (!Number.isInteger(number) || number < 1 || number > referenceCount) {
      throw Object.assign(new Error(`提示词引用了不存在的 @音频${match[1]}`), { status: 400 });
    }
  }
}

async function parseGenerationInput(formData) {
  const mode = String(formData.get("mode") || "").trim();
  const textPrompt = String(formData.get("textPrompt") || "").trim();
  const format = String(formData.get("format") || "mp3").trim().toLowerCase();
  const audioFiles = formData.getAll("referenceAudio").filter((item) => item instanceof File && item.size > 0);

  if (!MODE_SET.has(mode)) throw Object.assign(new Error("请选择音频生成方式"), { status: 400 });
  if (!textPrompt) throw Object.assign(new Error("请输入音频描述或待合成文本"), { status: 400 });
  if (textPrompt.length > DOUBAO_AUDIO_TEXT_MAX_LENGTH) {
    throw Object.assign(new Error(`音频描述最多支持 ${DOUBAO_AUDIO_TEXT_MAX_LENGTH} 个字符`), { status: 400 });
  }
  if (!FORMAT_SET.has(format)) throw Object.assign(new Error("不支持的输出音频格式"), { status: 400 });

  const speechRate = readInteger(formData.get("speechRate"), "语速", -50, 100, 0);
  const enableSubtitle = readBoolean(formData.get("enableSubtitle"), "字幕");

  if (mode === "text" && audioFiles.length) {
    throw Object.assign(new Error("纯文本生成不能携带参考文件"), { status: 400 });
  }
  if (mode === "audio-reference") {
    if (audioFiles.length < 1 || audioFiles.length > DOUBAO_AUDIO_REFERENCE_MAX_COUNT) {
      throw Object.assign(new Error("请上传 1 至 3 段参考音频"), { status: 400 });
    }
  }
  validateAudioReferencesInPrompt(
    textPrompt,
    mode === "audio-reference" ? audioFiles.length : 0,
  );

  const audioReferences = [];
  for (const file of audioFiles) {
    const extension = getFileExtension(file.name);
    const buffer = Buffer.from(await file.arrayBuffer());
    const metadata = inspectDoubaoReferenceAudio(buffer, extension);
    audioReferences.push({ buffer, extension, metadata });
  }

  return {
    mode,
    textPrompt,
    format,
    speechRate,
    enableSubtitle,
    audioReferences,
    referenceCount: mode === "audio-reference" ? audioReferences.length : 0,
  };
}

async function pruneHistory(userId) {
  const stale = await DoubaoAudioGeneration.find({ userId, model: DOUBAO_AUDIO_MODEL })
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
    await DoubaoAudioGeneration.deleteOne({ _id: generation._id, userId });
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
    return jsonMessage(publicMessage(error, "读取 Doubao 音频记录失败"), getErrorStatus(error));
  }
}

export async function POST(request) {
  let mediaWriteLease = null;
  try {
    const auth = await requireUserRecord({ connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_REQUEST_BYTES) return jsonMessage("请求内容不能超过 32MB", 413);

    const limited = rateLimit(
      `media-doubao-audio-generation:${user.userId}:${getClientIP(request)}`,
      GENERATION_RATE_LIMIT,
    );
    if (!limited.success) return jsonMessage("音频生成请求过于频繁，请稍后再试", 429);

    let formData;
    try {
      formData = await request.formData();
    } catch {
      return jsonMessage("上传内容格式错误", 400);
    }
    if (getFormDataSize(formData) > MAX_REQUEST_BYTES) {
      return jsonMessage("请求内容不能超过 32MB", 413);
    }
    const input = await parseGenerationInput(formData);
    input.requestId = crypto.randomUUID();
    mediaWriteLease = await beginMediaWriteLease(user.userId);

    const upstream = await generateDoubaoAudio(input, { signal: request.signal });
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
        mode: input.mode,
        textPrompt: input.textPrompt,
        referenceCount: input.referenceCount,
        format: input.format,
        speechRate: input.speechRate,
        subtitleEnabled: input.enableSubtitle,
        hasSubtitle: Boolean(upstream.subtitle),
        subtitle: upstream.subtitle,
        duration: upstream.duration,
        originalDuration: upstream.originalDuration,
        requestId: upstream.requestId,
        upstreamLogId: upstream.logId,
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

    console.info("[Doubao Audio] generation created", {
      generationId,
      requestId: upstream.requestId,
      logId: upstream.logId,
    });
    try {
      await pruneHistory(user.userId);
    } catch (cleanupError) {
      console.error("[Doubao Audio] prune history:", cleanupError);
    }
    return Response.json({
      success: true,
      generation: serializeDoubaoAudioGeneration(generation),
    }, { status: 201 });
  } catch (error) {
    console.error("[Doubao Audio] create generation:", {
      error,
      requestId: error?.requestId || "",
      logId: error?.logId || "",
    });
    return jsonMessage(publicMessage(error, "Doubao 音频生成失败"), getErrorStatus(error));
  } finally {
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((error) => {
        console.error("[Doubao Audio] release media write lease:", error);
      });
    }
  }
}
