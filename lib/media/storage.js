import crypto from "node:crypto";
import {
  createStoredFile,
  createStoredFileFromWebStream,
  serializeStoredFile,
} from "@/lib/server/storage/service";

const MIME_TO_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
};

function normalizeContentType(value, fallback) {
  const mimeType = String(value || "").toLowerCase().split(";")[0].trim();
  return MIME_TO_EXT[mimeType] ? mimeType : fallback;
}

async function saveMedia({
  userId,
  input,
  mimeType,
  category,
  kind,
  ownerType,
  ownerId,
  mediaWriteLease,
}) {
  const fallbackMime = category === "image"
    ? "image/png"
    : category === "audio"
      ? "audio/mpeg"
      : "video/mp4";
  const normalizedMime = normalizeContentType(mimeType, fallbackMime);
  const extension = MIME_TO_EXT[normalizedMime];
  const originalName = `${kind}-${crypto.randomUUID()}.${extension}`;
  const stored = await createStoredFile({
    userId,
    input,
    originalName,
    mimeType: normalizedMime,
    extension,
    category,
    kind,
    ownerType,
    ownerId,
    mediaWriteLease,
  });
  return { ...serializeStoredFile(stored), storedFile: stored };
}

export function saveImageBuffer({
  userId,
  input,
  mimeType = "image/png",
  ownerType = "image-result",
  ownerId,
  mediaWriteLease,
}) {
  return saveMedia({
    userId,
    input,
    mimeType,
    category: "image",
    kind: "media-image",
    ownerType,
    ownerId: ownerId || userId,
    mediaWriteLease,
  });
}

export function saveVideoBuffer({
  userId,
  input,
  mimeType = "video/mp4",
  ownerId,
  mediaWriteLease,
}) {
  return saveMedia({
    userId,
    input,
    mimeType,
    category: "video",
    kind: "media-video",
    ownerType: "video-task",
    ownerId,
    mediaWriteLease,
  });
}

export function saveConversationVideoBuffer({
  userId,
  input,
  mimeType = "video/mp4",
  conversationId,
  mediaWriteLease,
}) {
  return saveMedia({
    userId,
    input,
    mimeType,
    category: "video",
    kind: "media-video",
    ownerType: "conversation",
    ownerId: conversationId,
    mediaWriteLease,
  });
}

export async function saveMediaFromUrl({
  userId,
  url,
  mimeType,
  ownerType = "image-result",
  ownerId,
  signal,
  mediaWriteLease,
}) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`下载媒体失败（${response.status}）`);
  const responseType = response.headers.get("content-type") || mimeType;
  return saveImageBuffer({
    userId,
    input: await response.arrayBuffer(),
    mimeType: responseType,
    ownerType,
    ownerId,
    mediaWriteLease,
  });
}

export function normalizeAliyunAudioUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    const hostname = parsed.hostname.toLowerCase();
    const isHttps = parsed.protocol === "https:";
    const isOfficialHttpResult = (
      parsed.protocol === "http:"
      && /^dashscope-result(?:-[a-z0-9-]+)?\.oss-[a-z0-9-]+\.aliyuncs\.com$/i.test(hostname)
    );
    if (
      (!isHttps && !isOfficialHttpResult)
      || parsed.username
      || parsed.password
      || !hostname.endsWith(".aliyuncs.com")
      || (parsed.port && parsed.port !== (isHttps ? "443" : "80"))
    ) {
      return "";
    }
    // DashScope 的结果示例可能返回 HTTP OSS 签名地址；OSS 签名不绑定协议，
    // 因此保留完整路径与查询参数，只把传输安全升级为 HTTPS。
    if (isOfficialHttpResult) {
      parsed.protocol = "https:";
      parsed.port = "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

export function isAllowedAliyunAudioUrl(value) {
  return Boolean(normalizeAliyunAudioUrl(value));
}

export async function saveAudioFromUrl({
  userId,
  url,
  format,
  ownerId,
  signal,
  mediaWriteLease,
}) {
  const normalizedFormat = String(format || "").toLowerCase();
  if (!["mp3", "wav"].includes(normalizedFormat)) {
    throw new Error("仅支持保存 MP3 或 WAV 音频");
  }
  if (!ownerId) throw new Error("语音记录缺少文件归属");
  const safeAudioUrl = normalizeAliyunAudioUrl(url);
  if (!safeAudioUrl) {
    throw new Error("语音服务返回了不安全的音频地址");
  }

  let response;
  try {
    response = await fetch(safeAudioUrl, {
      redirect: "error",
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    const downloadError = new Error("下载语音文件失败");
    downloadError.cause = error;
    throw downloadError;
  }
  if (!response.ok) {
    throw new Error(`下载语音文件失败（${response.status}）`);
  }
  if (!response.body) throw new Error("语音服务未返回音频内容");

  const mimeType = normalizedFormat === "wav" ? "audio/wav" : "audio/mpeg";
  const timestamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "");
  const originalName = `vectaix-audio-${timestamp}.${normalizedFormat}`;
  let stored;
  try {
    stored = await createStoredFileFromWebStream({
      userId,
      input: response.body,
      originalName,
      mimeType,
      extension: normalizedFormat,
      category: "audio",
      kind: "media-audio",
      ownerType: "audio-generation",
      ownerId,
      signal,
      mediaWriteLease,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    const storageError = new Error("保存语音文件失败");
    storageError.cause = error;
    throw storageError;
  }
  return { ...serializeStoredFile(stored), storedFile: stored };
}

export function saveVoiceSampleBuffer({
  userId,
  input,
  mimeType,
  originalName,
  ownerId,
  mediaWriteLease,
}) {
  if (!ownerId) throw new Error("复刻样本缺少音色归属");
  const normalizedMime = normalizeContentType(mimeType, "");
  const extension = MIME_TO_EXT[normalizedMime];
  if (!["mp3", "wav", "m4a"].includes(extension)) {
    throw new Error("复刻样本仅支持 WAV、MP3 或 M4A");
  }
  return createStoredFile({
    userId,
    input,
    originalName,
    mimeType: normalizedMime,
    extension,
    category: "audio",
    kind: "voice-sample",
    ownerType: "voice-profile",
    ownerId,
    mediaWriteLease,
  });
}
