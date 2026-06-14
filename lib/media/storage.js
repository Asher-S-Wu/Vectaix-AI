import crypto from "crypto";
import { put } from "@vercel/blob";

const MEDIA_BLOB_ROUTE_PREFIX = "/api/media/blob";

const MIME_TO_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
};

function makeFilename(prefix, ext) {
  const id = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString("hex");
  return `${prefix}-${id}.${ext}`;
}

function getExtFromMimeType(mimeType, fallback = "bin") {
  return MIME_TO_EXT[String(mimeType || "").toLowerCase()] || fallback;
}

export function isPrivateBlobUrl(input) {
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" &&
      host.endsWith(".vercel-storage.com") &&
      host.includes(".private.blob.");
  } catch {
    return false;
  }
}

export function buildMediaBlobUrl(blobUrl) {
  const normalized = String(blobUrl || "").trim();
  return normalized
    ? `${MEDIA_BLOB_ROUTE_PREFIX}?url=${encodeURIComponent(normalized)}`
    : MEDIA_BLOB_ROUTE_PREFIX;
}

async function putMediaBlob(filename, buffer, contentType) {
  const blob = await put(filename, buffer, {
    access: "private",
    contentType,
  });

  return {
    url: buildMediaBlobUrl(blob.url),
    blobUrl: blob.url,
    mimeType: contentType,
  };
}

export async function saveImageBuffer(input, mimeType = "image/png") {
  const ext = getExtFromMimeType(mimeType, "png");
  const filename = makeFilename("media-image", ext);
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input instanceof ArrayBuffer ? new Uint8Array(input) : input);
  return putMediaBlob(filename, buffer, mimeType);
}

export async function saveVideoBuffer(input, mimeType = "video/mp4") {
  const ext = getExtFromMimeType(mimeType, "mp4");
  const filename = makeFilename("media-video", ext);
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input instanceof ArrayBuffer ? new Uint8Array(input) : input);
  return putMediaBlob(filename, buffer, mimeType);
}

export async function saveMediaFromUrl(url, mimeType, prefix) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载媒体失败（${response.status}）`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const contentType = response.headers.get("content-type") || mimeType;
  if (prefix === "media-image") {
    return saveImageBuffer(arrayBuffer, contentType);
  }
  return saveVideoBuffer(arrayBuffer, contentType);
}
