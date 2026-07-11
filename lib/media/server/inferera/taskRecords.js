import VideoGenerationTask from "@/models/VideoGenerationTask";
import {
  VIDEO_ACTIVE_STATUSES,
  buildUpstreamTaskPatch,
  getUpstreamVideoTask,
  storeUpstreamVideoOutput,
} from "@/lib/media/server/inferera/videos";

function normalizeObject(value) {
  if (!value || typeof value !== "object") return null;
  return typeof value.toObject === "function" ? value.toObject() : value;
}

export function serializeVideoTask(task) {
  const item = normalizeObject(task);
  if (!item) return null;
  return {
    id: String(item._id || item.id || ""),
    upstreamTaskId: item.upstreamTaskId || "",
    status: item.status || "queued",
    model: item.model || "",
    prompt: item.prompt || "",
    inputMode: item.inputMode || "text",
    params: item.params || {},
    error: item.error || null,
    usage: item.usage || null,
    upstream: item.upstreamResponse || null,
    videoUrl: item.videoUrl || "",
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
    upstreamCreatedAt: item.upstreamCreatedAt || null,
    upstreamUpdatedAt: item.upstreamUpdatedAt || null,
  };
}

export function shouldSyncVideoTask(task) {
  const item = normalizeObject(task);
  return Boolean(item && (VIDEO_ACTIVE_STATUSES.has(item.status) || (item.status === "completed" && !item.videoUrl)));
}

export async function syncVideoTaskRecord(task, { signal } = {}) {
  const item = normalizeObject(task);
  const upstreamTask = await getUpstreamVideoTask(item.upstreamTaskId, { signal });
  const patch = buildUpstreamTaskPatch(upstreamTask);
  if (patch.status === "completed" && !item.videoUrl) {
    const stored = await storeUpstreamVideoOutput(item.upstreamTaskId, { signal });
    patch.videoUrl = stored.url;
    patch.videoBlobUrl = stored.blobUrl;
  }
  return VideoGenerationTask.findByIdAndUpdate(item._id, { $set: patch }, { new: true }).lean();
}
