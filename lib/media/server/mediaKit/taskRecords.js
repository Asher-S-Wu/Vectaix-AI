import { normalizeVideoEnhancementError } from "@/lib/media/shared/videoEnhancement";
import { buildStoredFileUrl } from "@/lib/server/storage/service";

function normalizeObject(value) {
  if (!value || typeof value !== "object") return null;
  return typeof value.toObject === "function" ? value.toObject() : value;
}

function serializeTaskError(item) {
  if (!["failed", "canceled"].includes(item.status)) return null;
  const code = item.error?.code || (item.status === "canceled" ? "TASK_CANCELED" : "TASK_FAILED");
  return normalizeVideoEnhancementError({ code });
}

function serializeTaskResult(item) {
  if (item.status !== "completed" || !item.videoFileId || !item.result) return null;
  const videoUrl = buildStoredFileUrl(String(item.videoFileId));
  if (!videoUrl) return null;
  return {
    videoUrl,
    downloadUrl: `${videoUrl}?download=1`,
    size: item.result.size,
    duration: item.result.duration,
    resolution: item.result.resolution,
    fps: item.result.fps,
  };
}

export function serializeMediaKitUploadTicket(ticket) {
  const item = normalizeObject(ticket);
  if (!item) return null;
  return {
    id: String(item._id || item.id || ""),
    status: item.status,
    name: item.safeOriginalName,
    size: item.size,
    mimeType: item.mimeType,
    expiresAt: item.expiresAt || null,
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
  };
}

export function serializeVideoEnhancementTask(task) {
  const item = normalizeObject(task);
  if (!item) return null;
  const source = {
    type: item.sourceType,
    name: item.sourceName,
  };
  if (item.sourceType === "url") source.host = item.sourceHost;
  return {
    id: String(item._id || item.id || ""),
    model: item.model,
    status: item.status,
    source,
    settings: {
      resolution: item.settings?.resolution,
      fps: item.settings?.fps ?? null,
      bitrate: {
        mode: item.settings?.bitrate?.mode,
        value: item.settings?.bitrate?.value,
      },
    },
    error: serializeTaskError(item),
    result: serializeTaskResult(item),
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
    lastSyncedAt: item.lastSyncedAt || null,
  };
}
