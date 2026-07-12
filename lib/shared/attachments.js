export const IMAGE_MIME_TYPES = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export const VIDEO_MIME_TYPES = Object.freeze([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
]);

export const AUDIO_MIME_TYPES = Object.freeze([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
  "audio/ogg",
  "audio/webm",
]);

const VIDEO_EXTENSIONS = ["mp4", "mov", "webm", "m4v"];
const AUDIO_EXTENSIONS = ["mp3", "wav", "m4a", "aac", "ogg", "weba"];

export const SUPPORTED_UPLOAD_EXTENSIONS = Object.freeze([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  ...VIDEO_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
]);

export const MAX_CHAT_ATTACHMENTS = 5;

const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const ATTACHMENT_LIMITS = Object.freeze({
  image: { maxBytes: MAX_FILE_BYTES },
  video: { maxBytes: MAX_FILE_BYTES },
  audio: { maxBytes: MAX_FILE_BYTES },
});

export function normalizeMimeType(value) {
  return typeof value === "string" ? value.split(";")[0].trim().toLowerCase() : "";
}

export function getFileExtension(name) {
  if (typeof name !== "string") return "";
  const trimmed = name.trim().toLowerCase();
  const index = trimmed.lastIndexOf(".");
  if (index < 0 || index === trimmed.length - 1) return "";
  return trimmed.slice(index + 1);
}

export function isImageMimeType(mimeType) {
  return IMAGE_MIME_TYPES.includes(normalizeMimeType(mimeType));
}

export function isVideoMimeType(mimeType) {
  return VIDEO_MIME_TYPES.includes(normalizeMimeType(mimeType));
}

export function isAudioMimeType(mimeType) {
  return AUDIO_MIME_TYPES.includes(normalizeMimeType(mimeType));
}

export function isSupportedUploadExtension(extension) {
  return SUPPORTED_UPLOAD_EXTENSIONS.includes(String(extension || "").toLowerCase());
}

export function getAttachmentCategory({ extension, mimeType }) {
  const ext = String(extension || "").toLowerCase();
  const normalizedMime = normalizeMimeType(mimeType);

  if (isImageMimeType(normalizedMime) || ["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) {
    return "image";
  }
  if (isVideoMimeType(normalizedMime) || VIDEO_EXTENSIONS.includes(ext)) {
    return "video";
  }
  if (isAudioMimeType(normalizedMime) || AUDIO_EXTENSIONS.includes(ext)) {
    return "audio";
  }
  return "";
}

export function getAttachmentLimits(category) {
  return ATTACHMENT_LIMITS[category] || null;
}

export function getAttachmentInputType(category) {
  const normalizedCategory = String(category || "").toLowerCase();
  if (normalizedCategory === "image") return "image";
  if (normalizedCategory === "video") return "video";
  if (normalizedCategory === "audio") return "audio";
  return "";
}

export function createAttachmentDescriptor({
  url,
  name,
  mimeType,
  size,
  extension,
  category,
}) {
  const normalizedExtension = String(extension || getFileExtension(name)).toLowerCase();
  const normalizedMime = normalizeMimeType(mimeType);
  const normalizedCategory = category || getAttachmentCategory({ extension: normalizedExtension, mimeType: normalizedMime });
  return {
    url,
    name: typeof name === "string" ? name : "",
    mimeType: normalizedMime,
    size: Number.isFinite(size) ? size : 0,
    extension: normalizedExtension,
    category: normalizedCategory,
  };
}

export function formatFileSize(size) {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes >= 10 * 1024 ? 0 : 1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

export function getAttachmentAcceptForModel({ supportsImages, supportsVideo = false, supportsAudio = false }) {
  const accept = [];
  if (supportsImages) accept.push(...IMAGE_MIME_TYPES);
  if (supportsVideo) accept.push(...VIDEO_MIME_TYPES);
  if (supportsAudio) accept.push(...AUDIO_MIME_TYPES);
  if (accept.length > 0) {
    return Array.from(new Set(accept)).join(",");
  }
  return "";
}
