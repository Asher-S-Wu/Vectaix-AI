import crypto from "node:crypto";
import {
  createStoredFile,
  serializeStoredFile,
} from "@/lib/server/storage/service";

const MIME_TO_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
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
  const fallbackMime = category === "image" ? "image/png" : "audio/mpeg";
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

export function saveGeneratedAudioBuffer({
  userId,
  input,
  mimeType,
  ownerId,
  mediaWriteLease,
}) {
  if (!ownerId) throw new Error("音频生成记录缺少文件归属");
  return saveMedia({
    userId,
    input,
    mimeType,
    category: "audio",
    kind: "media-audio",
    ownerType: "audio-generation",
    ownerId,
    mediaWriteLease,
  });
}
