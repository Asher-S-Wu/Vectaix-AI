import mongoose from "mongoose";
import dbConnect from "@/lib/db";
import VideoEnhancementTask from "@/models/VideoEnhancementTask";
import { deleteStoredFilesByOwner } from "@/lib/server/storage/service";
import {
  assertMediaWriteLeaseActive,
  beginMediaWriteLease,
  endMediaWriteLease,
} from "@/lib/media/server/userOperationLeases";

const TERMINAL_STATUSES = Object.freeze(["completed", "failed", "canceled"]);
const DELETION_BATCH_SIZE = 12;
const DELETION_CONCURRENCY = 2;
const deletionCleanupInFlight = new Map();

export const VIDEO_ENHANCEMENT_DELETION_CLEANUP_TIMEOUT_MS = 10 * 1000;

function invalidDeletionTargetError() {
  const error = new TypeError("视频画质增强任务删除目标无效");
  error.code = "INVALID_DELETION_TARGET";
  return error;
}

function safeErrorDetails(error) {
  const errorType = /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error?.name || "")
    ? error.name
    : "Error";
  const code = /^[A-Z][A-Z0-9_]{0,63}$/.test(error?.code || "")
    ? error.code
    : "INTERNAL_ERROR";
  return { errorType, code };
}

function deletionTimeoutError() {
  const error = new Error("视频画质增强任务删除清理超时");
  error.name = "VideoEnhancementTaskDeletionTimeoutError";
  error.code = "TASK_DELETION_TIMEOUT";
  return error;
}

function throwIfAborted(signal) {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : deletionTimeoutError();
}

async function performVideoEnhancementTaskDeletion({
  taskId,
  userId,
  signal,
}) {
  let mediaWriteLease = null;
  let releasePromise = null;
  const releaseMediaWriteLease = () => {
    if (!mediaWriteLease) return Promise.resolve();
    if (!releasePromise) {
      releasePromise = endMediaWriteLease(mediaWriteLease);
      releasePromise.catch((error) => {
        console.error(
          "[AI MediaKit] release task deletion cleanup lease failed",
          { taskId, ...safeErrorDetails(error) },
        );
      });
    }
    return releasePromise;
  };
  const stopLeaseOnAbort = () => {
    const pendingRelease = releaseMediaWriteLease();
    pendingRelease.catch(() => {});
  };
  signal.addEventListener("abort", stopLeaseOnAbort, { once: true });
  try {
    throwIfAborted(signal);
    mediaWriteLease = await beginMediaWriteLease(userId);
    throwIfAborted(signal);
    await assertMediaWriteLeaseActive(mediaWriteLease);
    throwIfAborted(signal);

    const intent = await VideoEnhancementTask.findOne({
      _id: taskId,
      userId,
      status: { $in: TERMINAL_STATUSES },
      deletionRequestedAt: { $type: "date" },
    }).select("_id userId +deletionRequestedAt").lean();
    throwIfAborted(signal);
    if (!intent) return Object.freeze({ deleted: true });

    await deleteStoredFilesByOwner({
      userId,
      ownerType: "video-enhancement-task",
      ownerId: taskId,
    });
    throwIfAborted(signal);
    await assertMediaWriteLeaseActive(mediaWriteLease);
    throwIfAborted(signal);
    await VideoEnhancementTask.deleteOne({
      _id: taskId,
      userId,
      status: { $in: TERMINAL_STATUSES },
      deletionRequestedAt: intent.deletionRequestedAt,
    });
    return Object.freeze({ deleted: true });
  } finally {
    signal.removeEventListener("abort", stopLeaseOnAbort);
    await releaseMediaWriteLease().catch(() => {});
  }
}

function startDeletionCleanup({ taskId, userId, timeoutMs, key }) {
  const abortController = new AbortController();
  const operation = performVideoEnhancementTaskDeletion({
    taskId,
    userId,
    signal: abortController.signal,
  });
  operation.catch(() => {});

  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = deletionTimeoutError();
      if (!abortController.signal.aborted) abortController.abort(error);
      reject(error);
    }, timeoutMs);
    timer.unref?.();
  });
  timeout.catch(() => {});
  const result = Promise.race([operation, timeout]);
  result.catch(() => {});

  const entry = { result };
  deletionCleanupInFlight.set(key, entry);
  operation.then(
    () => {
      if (timer) clearTimeout(timer);
      if (deletionCleanupInFlight.get(key) === entry) deletionCleanupInFlight.delete(key);
    },
    () => {
      if (timer) clearTimeout(timer);
      if (deletionCleanupInFlight.get(key) === entry) deletionCleanupInFlight.delete(key);
    },
  );
  return entry;
}

export function cleanupVideoEnhancementTaskDeletion(
  { taskId, userId },
  { timeoutMs = VIDEO_ENHANCEMENT_DELETION_CLEANUP_TIMEOUT_MS } = {},
) {
  if (!mongoose.isValidObjectId(taskId) || !mongoose.isValidObjectId(userId)) {
    throw invalidDeletionTargetError();
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw invalidDeletionTargetError();

  const normalizedTaskId = String(taskId);
  const normalizedUserId = String(userId);
  const key = `${normalizedUserId}:${normalizedTaskId}`;
  const existing = deletionCleanupInFlight.get(key);
  if (existing) return existing.result;
  return startDeletionCleanup({
    taskId: normalizedTaskId,
    userId: normalizedUserId,
    timeoutMs,
    key,
  }).result;
}

export async function reconcileMediaKitVideoEnhancementTaskDeletions() {
  await dbConnect();
  const tasks = await VideoEnhancementTask.find({
    deletionRequestedAt: { $type: "date" },
  })
    .select("_id userId +deletionRequestedAt")
    .sort({ deletionRequestedAt: 1, _id: 1 })
    .limit(DELETION_BATCH_SIZE)
    .maxTimeMS(VIDEO_ENHANCEMENT_DELETION_CLEANUP_TIMEOUT_MS)
    .lean();
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(DELETION_CONCURRENCY, tasks.length) },
    async () => {
      while (cursor < tasks.length) {
        const task = tasks[cursor];
        cursor += 1;
        try {
          await cleanupVideoEnhancementTaskDeletion(
            { taskId: task._id, userId: task.userId },
            { timeoutMs: VIDEO_ENHANCEMENT_DELETION_CLEANUP_TIMEOUT_MS },
          );
        } catch (error) {
          console.error(
            "[AI MediaKit] pending task deletion cleanup failed",
            { taskId: String(task._id), ...safeErrorDetails(error) },
          );
        }
      }
    },
  );
  await Promise.all(workers);
}
