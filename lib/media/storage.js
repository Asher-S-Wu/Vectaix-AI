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
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

function normalizeContentType(value, fallback) {
  const mimeType = String(value || "").toLowerCase().split(";")[0].trim();
  return MIME_TO_EXT[mimeType] ? mimeType : fallback;
}

async function saveMedia({ userId, input, mimeType, category, kind, ownerType, ownerId }) {
  const normalizedMime = normalizeContentType(mimeType, category === "image" ? "image/png" : "video/mp4");
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
  });
  return { ...serializeStoredFile(stored), storedFile: stored };
}

export function saveImageBuffer({ userId, input, mimeType = "image/png", ownerType = "image-result", ownerId }) {
  return saveMedia({
    userId,
    input,
    mimeType,
    category: "image",
    kind: "media-image",
    ownerType,
    ownerId: ownerId || userId,
  });
}

export function saveVideoBuffer({ userId, input, mimeType = "video/mp4", ownerId }) {
  return saveMedia({
    userId,
    input,
    mimeType,
    category: "video",
    kind: "media-video",
    ownerType: "video-task",
    ownerId,
  });
}

export async function saveMediaFromUrl({ userId, url, mimeType, ownerType = "image-result", ownerId, signal }) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`下载媒体失败（${response.status}）`);
  const responseType = response.headers.get("content-type") || mimeType;
  return saveImageBuffer({
    userId,
    input: await response.arrayBuffer(),
    mimeType: responseType,
    ownerType,
    ownerId,
  });
}
