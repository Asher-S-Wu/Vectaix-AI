import VideoGenerationTask from "@/models/VideoGenerationTask";
import {
  VIDEO_ACTIVE_STATUSES,
  buildHappyHorseTaskPatch,
  getHappyHorseVideoTask,
} from "@/lib/media/server/happyhorse/videos";
import { saveVideoFromUrl } from "@/lib/media/storage";
import {
  buildStoredFileUrl,
  deleteOwnedTemporaryFile,
  deleteStoredFilesByIds,
  deleteStoredFilesByOwner,
} from "@/lib/server/storage/service";
import { assertMediaWriteLeaseActive } from "@/lib/media/server/userOperationLeases";

const FINALIZATION_STALE_MS = 20 * 60 * 1000;
const RESULT_SAVE_TIMEOUT_MS = 15 * 60 * 1000;
const UNSUBMITTED_TASK_STALE_MS = 10 * 60 * 1000;
const UPSTREAM_POLL_MIN_INTERVAL_MS = 40 * 1000;
const UPSTREAM_QUERY_LIMIT = 18;
const UPSTREAM_QUERY_WINDOW_MS = 1000;
const upstreamQueryTimestamps = [];

function normalizeObject(value) {
  if (!value || typeof value !== "object") return null;
  return typeof value.toObject === "function" ? value.toObject() : value;
}

function claimUpstreamQuerySlot(now = Date.now()) {
  while (
    upstreamQueryTimestamps.length
    && upstreamQueryTimestamps[0] <= now - UPSTREAM_QUERY_WINDOW_MS
  ) {
    upstreamQueryTimestamps.shift();
  }
  if (upstreamQueryTimestamps.length >= UPSTREAM_QUERY_LIMIT) return false;
  upstreamQueryTimestamps.push(now);
  return true;
}

export function serializeVideoTask(task) {
  const item = normalizeObject(task);
  if (!item) return null;
  const videoFileId = item.videoFileId ? String(item.videoFileId) : "";
  return {
    id: String(item._id || item.id || ""),
    upstreamTaskId: item.upstreamTaskId || "",
    status: item.status || "queued",
    model: item.model || "",
    mode: item.mode || "text",
    prompt: item.prompt || "",
    params: item.params || {},
    error: item.error || null,
    usage: item.usage || null,
    videoFileId,
    videoUrl: videoFileId ? buildStoredFileUrl(videoFileId) : "",
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
    upstreamCreatedAt: item.upstreamCreatedAt || null,
    upstreamUpdatedAt: item.upstreamUpdatedAt || null,
  };
}

export function shouldSyncVideoTask(task) {
  const item = normalizeObject(task);
  return Boolean(item?.upstreamTaskId && VIDEO_ACTIVE_STATUSES.has(item.status));
}

export function isStaleFinalizingTask(task, now = new Date()) {
  const item = normalizeObject(task);
  if (item?.status !== "finalizing" || !item.finalizationStartedAt) return false;
  const startedAt = new Date(item.finalizationStartedAt).getTime();
  return Number.isFinite(startedAt) && now.getTime() - startedAt >= FINALIZATION_STALE_MS;
}

export function isStaleUnsubmittedTask(task, now = new Date()) {
  const item = normalizeObject(task);
  if (item?.status !== "queued" || item.upstreamTaskId || !item.createdAt) return false;
  const createdAt = new Date(item.createdAt).getTime();
  return Number.isFinite(createdAt) && now.getTime() - createdAt >= UNSUBMITTED_TASK_STALE_MS;
}

async function deleteTaskInputs(item, mediaWriteLease) {
  if (mediaWriteLease) await assertMediaWriteLeaseActive(mediaWriteLease);
  let deletedCount = await deleteStoredFilesByIds({
    userId: item.userId,
    fileIds: item.inputFileIds || [],
    ownerType: "video-task",
    ownerId: item._id,
  });
  for (const fileId of item.inputFileIds || []) {
    const deleted = await deleteOwnedTemporaryFile({ userId: item.userId, fileId });
    if (deleted) deletedCount += 1;
  }
  return deletedCount;
}

async function deleteAllTaskFiles(item, mediaWriteLease) {
  if (mediaWriteLease) await assertMediaWriteLeaseActive(mediaWriteLease);
  let deletedCount = await deleteStoredFilesByOwner({
    userId: item.userId,
    ownerType: "video-task",
    ownerId: item._id,
  });
  for (const fileId of item.inputFileIds || []) {
    const deleted = await deleteOwnedTemporaryFile({ userId: item.userId, fileId });
    if (deleted) deletedCount += 1;
  }
  return deletedCount;
}

async function markTerminalFailure(item, patch, error) {
  const errorMessage = error instanceof Error ? error.message : "";
  const failure = {
    code: error?.code || patch?.error?.code || "VIDEO_TASK_FAILED",
    message: error instanceof Error
      ? /[\u3400-\u9fff]/u.test(errorMessage) ? errorMessage : "保存生成结果失败"
      : patch?.error?.message || "视频任务失败",
  };
  return VideoGenerationTask.findByIdAndUpdate(
    item._id,
    {
      $set: {
        status: patch?.status === "canceled" ? "canceled" : "failed",
        error: failure,
        usage: patch?.usage || null,
        upstreamResponse: patch?.upstreamResponse || null,
        upstreamCreatedAt: patch?.upstreamCreatedAt || item.upstreamCreatedAt || null,
        upstreamUpdatedAt: patch?.upstreamUpdatedAt || new Date(),
        sourceAccessRevokedAt: new Date(),
      },
      $unset: { sourceAccessTokenHash: 1 },
    },
    { new: true },
  ).lean();
}

export async function applyHappyHorseTaskResult(
  task,
  upstreamTask,
  { mediaWriteLease } = {},
) {
  const item = normalizeObject(task);
  const patch = buildHappyHorseTaskPatch(upstreamTask);
  if (VIDEO_ACTIVE_STATUSES.has(patch.status)) {
    if (mediaWriteLease) await assertMediaWriteLeaseActive(mediaWriteLease);
    const updated = await VideoGenerationTask.findOneAndUpdate(
      { _id: item._id, status: { $in: [...VIDEO_ACTIVE_STATUSES] } },
      {
        $set: {
          status: patch.status,
          error: null,
          usage: patch.usage,
          upstreamResponse: patch.upstreamResponse,
          upstreamCreatedAt: patch.upstreamCreatedAt || item.upstreamCreatedAt || null,
          upstreamUpdatedAt: patch.upstreamUpdatedAt,
        },
      },
      { new: true },
    ).lean();
    return updated || VideoGenerationTask.findById(item._id).lean();
  }

  if (mediaWriteLease) await assertMediaWriteLeaseActive(mediaWriteLease);
  const finalizationStartedAt = new Date();
  const workingItem = await VideoGenerationTask.findOneAndUpdate(
    { _id: item._id, status: { $in: [...VIDEO_ACTIVE_STATUSES] } },
    {
      $set: {
        status: "finalizing",
        usage: patch.usage,
        upstreamResponse: patch.upstreamResponse,
        upstreamCreatedAt: patch.upstreamCreatedAt || item.upstreamCreatedAt || null,
        upstreamUpdatedAt: patch.upstreamUpdatedAt,
        finalizationStartedAt,
        sourceAccessRevokedAt: finalizationStartedAt,
      },
      $unset: { sourceAccessTokenHash: 1 },
    },
    { new: true },
  ).lean();
  if (!workingItem) return VideoGenerationTask.findById(item._id).lean();

  try {
    await deleteTaskInputs(workingItem, mediaWriteLease);
  } catch (error) {
    return markTerminalFailure(workingItem, patch, new Error("视频任务结束，但清理输入素材失败"));
  }

  if (patch.status !== "completed") {
    return markTerminalFailure(workingItem, patch, null);
  }
  if (!patch.outputUrl) {
    return markTerminalFailure(workingItem, patch, new Error("HappyHorse 未返回生成结果地址"));
  }

  let stored;
  try {
    stored = await saveVideoFromUrl({
      userId: workingItem.userId,
      url: patch.outputUrl,
      ownerId: workingItem._id,
      signal: AbortSignal.timeout(RESULT_SAVE_TIMEOUT_MS),
      mediaWriteLease,
    });
  } catch (error) {
    return markTerminalFailure(workingItem, patch, error);
  }

  try {
    if (mediaWriteLease) await assertMediaWriteLeaseActive(mediaWriteLease);
    const completed = await VideoGenerationTask.findOneAndUpdate(
      { _id: workingItem._id, status: "finalizing", finalizationStartedAt },
      {
        $set: {
          status: "completed",
          error: null,
          usage: patch.usage,
          upstreamResponse: patch.upstreamResponse,
          videoFileId: stored.fileId,
          upstreamCreatedAt: patch.upstreamCreatedAt || item.upstreamCreatedAt || null,
          upstreamUpdatedAt: patch.upstreamUpdatedAt,
          sourceAccessRevokedAt: new Date(),
        },
        $unset: { sourceAccessTokenHash: 1 },
      },
      { new: true },
    ).lean();
    if (completed) return completed;
    await deleteStoredFilesByIds({
      userId: workingItem.userId,
      fileIds: [stored.fileId],
      ownerType: "video-task",
      ownerId: workingItem._id,
    });
    return VideoGenerationTask.findById(workingItem._id).lean();
  } catch (error) {
    await deleteStoredFilesByIds({
      userId: workingItem.userId,
      fileIds: [stored.fileId],
      ownerType: "video-task",
      ownerId: workingItem._id,
    }).catch(() => {});
    throw error;
  }
}

export async function failStaleUnsubmittedTask(task, { mediaWriteLease } = {}) {
  const item = normalizeObject(task);
  if (!isStaleUnsubmittedTask(item)) {
    return VideoGenerationTask.findById(item._id).lean();
  }
  if (mediaWriteLease) await assertMediaWriteLeaseActive(mediaWriteLease);
  const cutoff = new Date(Date.now() - UNSUBMITTED_TASK_STALE_MS);
  const failed = await VideoGenerationTask.findOneAndUpdate(
    {
      _id: item._id,
      status: "queued",
      upstreamTaskId: null,
      createdAt: { $lte: cutoff },
    },
    {
      $set: {
        status: "failed",
        error: {
          code: "VIDEO_TASK_SUBMISSION_INTERRUPTED",
          message: "视频任务提交过程已中断，请删除后重新创建",
        },
        sourceAccessRevokedAt: new Date(),
        upstreamUpdatedAt: new Date(),
      },
      $unset: { sourceAccessTokenHash: 1 },
    },
    { new: true },
  ).lean();
  if (!failed) return VideoGenerationTask.findById(item._id).lean();
  try {
    await deleteAllTaskFiles(failed, mediaWriteLease);
  } catch {
    await VideoGenerationTask.updateOne(
      { _id: failed._id, status: "failed" },
      { $set: { "error.message": "视频任务提交过程已中断，且输入素材清理失败" } },
    );
  }
  return VideoGenerationTask.findById(item._id).lean();
}

export async function failStaleFinalizingTask(task, { mediaWriteLease } = {}) {
  const item = normalizeObject(task);
  if (!isStaleFinalizingTask(item)) {
    return VideoGenerationTask.findById(item._id).lean();
  }
  if (mediaWriteLease) await assertMediaWriteLeaseActive(mediaWriteLease);
  const failed = await VideoGenerationTask.findOneAndUpdate(
    {
      _id: item._id,
      status: "finalizing",
      finalizationStartedAt: item.finalizationStartedAt,
    },
    {
      $set: {
        status: "failed",
        error: {
          code: "VIDEO_RESULT_SAVE_INTERRUPTED",
          message: "视频结果保存过程已中断",
        },
        sourceAccessRevokedAt: new Date(),
        upstreamUpdatedAt: new Date(),
      },
      $unset: { sourceAccessTokenHash: 1 },
    },
    { new: true },
  ).lean();
  if (!failed) return VideoGenerationTask.findById(item._id).lean();
  try {
    await deleteAllTaskFiles(failed, mediaWriteLease);
  } catch {
    await VideoGenerationTask.updateOne(
      { _id: failed._id, status: "failed" },
      { $set: { "error.message": "视频结果保存过程已中断，且残留文件清理失败" } },
    );
  }
  return VideoGenerationTask.findById(item._id).lean();
}

export async function syncVideoTaskRecord(task, { signal, mediaWriteLease } = {}) {
  const item = normalizeObject(task);
  const pollStartedAt = new Date();
  const pollCutoff = new Date(pollStartedAt.getTime() - UPSTREAM_POLL_MIN_INTERVAL_MS);
  const claimed = await VideoGenerationTask.findOneAndUpdate(
    {
      _id: item._id,
      upstreamTaskId: item.upstreamTaskId,
      status: { $in: [...VIDEO_ACTIVE_STATUSES] },
      $or: [
        { upstreamPolledAt: null },
        { upstreamPolledAt: { $lte: pollCutoff } },
      ],
    },
    { $set: { upstreamPolledAt: pollStartedAt } },
    { new: true },
  ).lean();
  if (!claimed) return VideoGenerationTask.findById(item._id).lean();

  if (!claimUpstreamQuerySlot()) return claimed;

  let upstreamTask;
  try {
    upstreamTask = await getHappyHorseVideoTask(claimed.upstreamTaskId, { signal });
  } catch (error) {
    if (error?.upstreamStatus !== 404) throw error;
    upstreamTask = {
      output: {
        task_id: claimed.upstreamTaskId,
        task_status: "UNKNOWN",
      },
    };
  }
  return applyHappyHorseTaskResult(claimed, upstreamTask, { mediaWriteLease });
}

export async function failCreatedVideoTask(task, error, { mediaWriteLease } = {}) {
  const item = normalizeObject(task);
  if (!item?._id) return null;
  const rawMessage = error instanceof Error ? error.message : "";
  let message = /[\u3400-\u9fff]/u.test(rawMessage)
    ? rawMessage
    : "HappyHorse 视频任务提交失败";
  if (mediaWriteLease) await assertMediaWriteLeaseActive(mediaWriteLease);
  const failed = await VideoGenerationTask.findOneAndUpdate(
    { _id: item._id, status: "queued", upstreamTaskId: null },
    {
      $set: {
        status: "failed",
        error: {
          code: error?.code || "VIDEO_TASK_SUBMISSION_FAILED",
          message,
        },
        sourceAccessRevokedAt: new Date(),
        upstreamUpdatedAt: new Date(),
      },
      $unset: { sourceAccessTokenHash: 1 },
    },
    { new: true },
  ).lean();
  if (!failed) return VideoGenerationTask.findById(item._id).lean();
  try {
    await deleteTaskInputs(failed, mediaWriteLease);
  } catch {
    message = `${message}；输入素材清理失败`;
    await VideoGenerationTask.updateOne(
      { _id: failed._id, status: "failed" },
      { $set: { "error.message": message } },
    );
  }
  return VideoGenerationTask.findById(item._id).lean();
}
