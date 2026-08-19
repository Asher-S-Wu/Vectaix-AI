import crypto from "node:crypto";
import dbConnect from "@/lib/db";
import StoredFile from "@/models/StoredFile";
import VideoEnhancementTask from "@/models/VideoEnhancementTask";
import { getMediaKitVideoEnhancementTask } from "@/lib/media/server/mediaKit/client";
import {
  MediaKitResultStorageError,
  saveMediaKitVideoEnhancementResult,
} from "@/lib/media/server/mediaKit/resultStorage";
import {
  deleteStoredFileDocument,
  deleteStoredFilesByOwner,
  normalizeFileId,
} from "@/lib/server/storage/service";
import {
  assertMediaWriteLeaseActive,
  beginMediaWriteLease,
  endMediaWriteLease,
} from "@/lib/media/server/userOperationLeases";
import { normalizeVideoEnhancementError } from "@/lib/media/shared/videoEnhancement";

const ACTIVE_STATUSES = Object.freeze(["running", "finalizing"]);
const RECONCILE_BATCH_SIZE = 12;
const RECONCILE_CONCURRENCY = 2;
const POLL_INTERVAL_MS = 30 * 1000;
const SUBMISSION_STALE_MS = 10 * 60 * 1000;
const TASK_LEASE_TTL_MS = 2 * 60 * 1000;
const TASK_LEASE_HEARTBEAT_MS = 20 * 1000;
const TASK_LEASE_SAFETY_WINDOW_MS = 30 * 1000;
const LEASE_OPERATION_TIMEOUT_MS = 10 * 1000;
const MEDIA_WRITE_LEASE_CHECK_MS = 15 * 1000;
const MONITOR_STOP_WAIT_MS = 2 * 1000;
const UPSTREAM_QUERY_TIMEOUT_MS = 30 * 1000;
const UPSTREAM_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
const UPSTREAM_EXPIRY_ENFORCEMENT_AT = Date.parse("2026-08-20T00:00:00+08:00");
const WORKER_INSTANCE_ID = `${process.pid}-${crypto.randomUUID()}`;
const TEMPORARY_QUERY_ERROR_CODES = new Set([
  "UPSTREAM_RATE_LIMITED",
  "UPSTREAM_INTERNAL_ERROR",
  "UPSTREAM_UNAVAILABLE",
  "UPSTREAM_TIMEOUT",
  "UPSTREAM_NETWORK_ERROR",
]);

class MediaKitTaskLeaseLostError extends Error {
  constructor() {
    super("MediaKit task lease lost");
    this.name = "MediaKitTaskLeaseLostError";
    this.code = "TASK_LEASE_LOST";
  }
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

function leaseAvailableFilter(now) {
  return {
    $or: [
      { lease: null },
      { lease: { $exists: false } },
      { "lease.expiresAt": { $lte: now } },
    ],
  };
}

function pollDueFilter(now) {
  return {
    $or: [
      { nextPollAt: null },
      { nextPollAt: { $exists: false } },
      { nextPollAt: { $lte: now } },
    ],
  };
}

function buildCandidateFilter(now) {
  return {
    deletionRequestedAt: null,
    $or: [
      {
        status: { $in: ACTIVE_STATUSES },
        upstreamTaskId: { $type: "string", $ne: "" },
        $and: [pollDueFilter(now), leaseAvailableFilter(now)],
      },
      {
        status: "submitting",
        upstreamTaskId: null,
        createdAt: { $lte: new Date(now.getTime() - SUBMISSION_STALE_MS) },
        $and: [leaseAvailableFilter(now)],
      },
    ],
  };
}

async function claimCandidate(candidate, now) {
  const owner = `${WORKER_INSTANCE_ID}:${crypto.randomUUID()}`;
  const commonFilter = {
    _id: candidate._id,
    deletionRequestedAt: null,
    $and: [leaseAvailableFilter(now)],
  };
  if (candidate.status === "submitting") {
    Object.assign(commonFilter, {
      status: "submitting",
      upstreamTaskId: null,
      createdAt: { $lte: new Date(now.getTime() - SUBMISSION_STALE_MS) },
    });
  } else {
    Object.assign(commonFilter, {
      status: candidate.status,
      upstreamTaskId: candidate.upstreamTaskId,
    });
    commonFilter.$and.push(pollDueFilter(now));
  }
  const task = await VideoEnhancementTask.findOneAndUpdate(
    commonFilter,
    {
      $set: {
        lease: {
          owner,
          expiresAt: new Date(now.getTime() + TASK_LEASE_TTL_MS),
        },
      },
    },
    { new: true },
  ).select("+upstreamTaskId +lease.owner").lean();
  return task ? { task, owner } : null;
}

async function assertTaskLeaseActive(taskId, owner) {
  const nativePromise = VideoEnhancementTask.exists({
    _id: taskId,
    "lease.owner": owner,
    $expr: { $gt: ["$lease.expiresAt", "$$NOW"] },
  }).maxTimeMS(LEASE_OPERATION_TIMEOUT_MS).exec();
  nativePromise.catch(() => {});
  const active = await promiseWithTimeout(
    nativePromise,
    LEASE_OPERATION_TIMEOUT_MS,
    () => new MediaKitTaskLeaseLostError(),
  );
  if (!active) throw new MediaKitTaskLeaseLostError();
}

function promiseWithTimeout(promise, timeoutMs, createTimeoutError) {
  const observed = Promise.resolve(promise);
  observed.catch(() => {});
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(createTimeoutError());
    }, timeoutMs);
    timer.unref?.();
    observed.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function waitForMonitorBriefly(promise) {
  if (!promise) return;
  await promiseWithTimeout(
    promise,
    MONITOR_STOP_WAIT_MS,
    () => new Error("MONITOR_STOP_TIMEOUT"),
  ).catch(() => {});
}

function startTaskLeaseHeartbeat(taskId, owner, initialExpiresAt, abortController) {
  let stopped = false;
  let timer = null;
  let watchdogTimer = null;
  let inFlight = null;
  let confirmedExpiresAtMs = new Date(initialExpiresAt).getTime();
  const clearTimers = () => {
    if (timer) clearTimeout(timer);
    if (watchdogTimer) clearTimeout(watchdogTimer);
    timer = null;
    watchdogTimer = null;
  };
  const abortLease = () => {
    clearTimers();
    if (!abortController.signal.aborted) {
      abortController.abort(new MediaKitTaskLeaseLostError());
    }
  };
  const resetWatchdog = () => {
    if (watchdogTimer) clearTimeout(watchdogTimer);
    watchdogTimer = null;
    if (stopped || abortController.signal.aborted) return;
    const delayMs = confirmedExpiresAtMs - Date.now() - TASK_LEASE_SAFETY_WINDOW_MS;
    if (!Number.isFinite(delayMs) || delayMs <= 0) {
      abortLease();
      return;
    }
    watchdogTimer = setTimeout(abortLease, delayMs);
    watchdogTimer.unref?.();
  };
  const schedule = () => {
    if (stopped || abortController.signal.aborted) return;
    const safeRemainingMs = confirmedExpiresAtMs
      - Date.now()
      - TASK_LEASE_SAFETY_WINDOW_MS
      - LEASE_OPERATION_TIMEOUT_MS;
    const delayMs = Math.max(0, Math.min(TASK_LEASE_HEARTBEAT_MS, safeRemainingMs));
    timer = setTimeout(run, delayMs);
    timer.unref?.();
  };
  const run = async () => {
    timer = null;
    if (stopped || abortController.signal.aborted) return;
    const requestStartedAt = new Date();
    const targetExpiresAt = new Date(requestStartedAt.getTime() + TASK_LEASE_TTL_MS);
    const nativePromise = VideoEnhancementTask.updateOne(
      {
        _id: taskId,
        status: { $in: ACTIVE_STATUSES },
        "lease.owner": owner,
        $expr: { $gt: ["$lease.expiresAt", "$$NOW"] },
      },
      { $max: { "lease.expiresAt": targetExpiresAt } },
    ).maxTimeMS(LEASE_OPERATION_TIMEOUT_MS).exec();
    nativePromise.catch(() => {});
    inFlight = nativePromise;
    try {
      const renewed = await promiseWithTimeout(
        nativePromise,
        LEASE_OPERATION_TIMEOUT_MS,
        () => new MediaKitTaskLeaseLostError(),
      );
      if (stopped) return;
      if (
        renewed.matchedCount !== 1
        || targetExpiresAt.getTime() <= Date.now() + TASK_LEASE_SAFETY_WINDOW_MS
      ) {
        abortLease();
        return;
      }
      confirmedExpiresAtMs = targetExpiresAt.getTime();
      resetWatchdog();
    } catch (error) {
      if (!stopped) {
        console.error(
          "[AI MediaKit] task lease renewal failed",
          { taskId: String(taskId), ...safeErrorDetails(error) },
        );
        abortLease();
      }
    } finally {
      inFlight = null;
      schedule();
    }
  };
  resetWatchdog();
  schedule();
  return async () => {
    stopped = true;
    clearTimers();
    await waitForMonitorBriefly(inFlight);
  };
}

function startMediaWriteLeaseMonitor(
  taskId,
  mediaWriteLease,
  abortController,
) {
  let stopped = false;
  let timer = null;
  let inFlight = null;
  const schedule = () => {
    if (stopped || abortController.signal.aborted) return;
    timer = setTimeout(run, MEDIA_WRITE_LEASE_CHECK_MS);
    timer.unref?.();
  };
  const run = async () => {
    timer = null;
    if (stopped || abortController.signal.aborted) return;
    const nativePromise = assertMediaWriteLeaseActive(mediaWriteLease);
    nativePromise.catch(() => {});
    inFlight = nativePromise;
    try {
      await promiseWithTimeout(
        nativePromise,
        LEASE_OPERATION_TIMEOUT_MS,
        () => new MediaKitTaskLeaseLostError(),
      );
    } catch (error) {
      if (!stopped) {
        if (!abortController.signal.aborted) abortController.abort(error);
        console.error(
          "[AI MediaKit] media write lease monitor failed",
          { taskId: String(taskId), ...safeErrorDetails(error) },
        );
      }
    } finally {
      inFlight = null;
      schedule();
    }
  };
  schedule();
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    await waitForMonitorBriefly(inFlight);
  };
}

async function releaseTaskLease(taskId, owner) {
  await VideoEnhancementTask.updateOne(
    { _id: taskId, "lease.owner": owner },
    { $unset: { lease: 1 } },
  );
}

function isExpiredTask(task, now) {
  if (now.getTime() < UPSTREAM_EXPIRY_ENFORCEMENT_AT) return false;
  const reference = task.upstreamCreatedAt || task.createdAt;
  const timestamp = reference ? new Date(reference).getTime() : Number.NaN;
  return Number.isFinite(timestamp)
    && timestamp <= now.getTime() - UPSTREAM_EXPIRY_MS;
}

function isWriteLeaseError(error) {
  return error?.name === "UserOperationLeaseError";
}

async function failClaimedTask(task, owner, code, { mediaWriteLease } = {}) {
  if (mediaWriteLease) await assertMediaWriteLeaseActive(mediaWriteLease);
  await assertTaskLeaseActive(task._id, owner);
  const safeError = normalizeVideoEnhancementError({ code });
  const status = safeError.code === "TASK_CANCELED" ? "canceled" : "failed";
  const terminal = await VideoEnhancementTask.findOneAndUpdate(
    {
      _id: task._id,
      status: task.status === "submitting" ? "submitting" : { $in: ACTIVE_STATUSES },
      "lease.owner": owner,
      $expr: { $gt: ["$lease.expiresAt", "$$NOW"] },
    },
    {
      $set: {
        status,
        videoFileId: null,
        result: null,
        error: { code: safeError.code },
        nextPollAt: null,
        lastSyncedAt: new Date(),
      },
      $unset: { lease: 1 },
    },
    { new: true, runValidators: true },
  ).lean();
  if (!terminal) return null;
  try {
    if (mediaWriteLease) await assertMediaWriteLeaseActive(mediaWriteLease);
    await deleteStoredFilesByOwner({
      userId: task.userId,
      ownerType: "video-enhancement-task",
      ownerId: task._id,
    });
  } catch (error) {
    console.error(
      "[AI MediaKit] terminal result cleanup failed",
      { taskId: String(task._id), ...safeErrorDetails(error) },
    );
  }
  return terminal;
}

async function postponeClaimedTask(task, owner) {
  const now = new Date();
  await VideoEnhancementTask.updateOne(
    {
      _id: task._id,
      status: { $in: ACTIVE_STATUSES },
      "lease.owner": owner,
      $expr: { $gt: ["$lease.expiresAt", "$$NOW"] },
    },
    {
      $set: { nextPollAt: new Date(now.getTime() + POLL_INTERVAL_MS) },
      $unset: { lease: 1 },
    },
  );
}

async function applyRunningResult(task, owner, upstream, mediaWriteLease) {
  await assertMediaWriteLeaseActive(mediaWriteLease);
  const now = new Date();
  await VideoEnhancementTask.updateOne(
    {
      _id: task._id,
      status: task.status,
      upstreamTaskId: task.upstreamTaskId,
      "lease.owner": owner,
      $expr: { $gt: ["$lease.expiresAt", "$$NOW"] },
    },
    {
      $set: {
        upstreamCreatedAt: task.upstreamCreatedAt || upstream.createdAt || now,
        lastSyncedAt: now,
        nextPollAt: new Date(now.getTime() + POLL_INTERVAL_MS),
      },
      $unset: { lease: 1 },
    },
  );
}

async function transitionToFinalizing(task, owner, upstream, mediaWriteLease) {
  if (task.status === "finalizing") return task;
  await assertMediaWriteLeaseActive(mediaWriteLease);
  const now = new Date();
  return VideoEnhancementTask.findOneAndUpdate(
    {
      _id: task._id,
      status: "running",
      upstreamTaskId: task.upstreamTaskId,
      "lease.owner": owner,
      $expr: { $gt: ["$lease.expiresAt", "$$NOW"] },
    },
    {
      $set: {
        status: "finalizing",
        finalizationStartedAt: now,
        upstreamCreatedAt: task.upstreamCreatedAt || upstream.createdAt || now,
        lastSyncedAt: now,
        nextPollAt: now,
      },
    },
    { new: true, runValidators: true },
  ).select("+upstreamTaskId +lease.owner").lean();
}

async function findAndValidateSavedFile(task, stored) {
  if (normalizeFileId(stored.fileId) !== stored.fileId) return null;
  const file = await StoredFile.findOne({ fileId: stored.fileId });
  if (
    !file
    || String(file.userId) !== String(task.userId)
    || file.ownerType !== "video-enhancement-task"
    || file.ownerId !== String(task._id)
    || normalizeFileId(file.fileId) !== file.fileId
    || file.size !== stored.size
  ) {
    return null;
  }
  return file;
}

async function cleanupSavedFile(fileId, task) {
  if (!fileId) return;
  const file = await StoredFile.findOne({
    fileId,
    userId: task.userId,
    ownerType: "video-enhancement-task",
    ownerId: String(task._id),
  });
  if (file) await deleteStoredFileDocument(file);
}

async function cleanupSupersededResultFiles(task, currentFileId, mediaWriteLease) {
  await assertMediaWriteLeaseActive(mediaWriteLease);
  const files = await StoredFile.find({
    userId: task.userId,
    ownerType: "video-enhancement-task",
    ownerId: String(task._id),
    fileId: { $ne: currentFileId },
  });
  for (const file of files) {
    try {
      await assertMediaWriteLeaseActive(mediaWriteLease);
      await deleteStoredFileDocument(file);
    } catch (error) {
      console.error(
        "[AI MediaKit] superseded result cleanup failed",
        {
          taskId: String(task._id),
          fileId: normalizeFileId(file.fileId) || "",
          ...safeErrorDetails(error),
        },
      );
    }
  }
}

async function finalizeCompletedResult({
  task,
  owner,
  upstream,
  abortController,
  mediaWriteLease,
}) {
  let stored = null;
  try {
    await assertTaskLeaseActive(task._id, owner);
    await assertMediaWriteLeaseActive(mediaWriteLease);
    stored = await saveMediaKitVideoEnhancementResult({
      taskId: task._id,
      userId: task.userId,
      videoUrl: upstream.result.videoUrl,
      signal: abortController.signal,
      mediaWriteLease,
      assertWriteCommitAllowed: async () => {
        try {
          await assertTaskLeaseActive(task._id, owner);
        } catch (error) {
          if (!abortController.signal.aborted) abortController.abort(error);
          throw error;
        }
      },
    });
    const file = await findAndValidateSavedFile(task, stored);
    if (!file) throw new MediaKitResultStorageError("RESULT_SAVE_FAILED");
    await assertTaskLeaseActive(task._id, owner);
    await assertMediaWriteLeaseActive(mediaWriteLease);
    const completedAt = new Date();
    const completed = await VideoEnhancementTask.findOneAndUpdate(
      {
        _id: task._id,
        status: "finalizing",
        upstreamTaskId: task.upstreamTaskId,
        "lease.owner": owner,
        $expr: { $gt: ["$lease.expiresAt", "$$NOW"] },
      },
      {
        $set: {
          status: "completed",
          videoFileId: stored.fileId,
          result: {
            size: stored.size,
            duration: upstream.result.duration,
            resolution: upstream.result.resolution,
            fps: upstream.result.fps,
          },
          error: null,
          nextPollAt: null,
          upstreamCreatedAt: task.upstreamCreatedAt || upstream.createdAt || completedAt,
          lastSyncedAt: completedAt,
        },
        $unset: { lease: 1 },
      },
      { new: true, runValidators: true },
    ).lean();
    if (!completed) {
      await cleanupSavedFile(stored.fileId, task);
      return null;
    }
    await cleanupSupersededResultFiles(
      task,
      stored.fileId,
      mediaWriteLease,
    ).catch((error) => {
      console.error(
        "[AI MediaKit] completed result cleanup failed",
        { taskId: String(task._id), ...safeErrorDetails(error) },
      );
    });
    return completed;
  } catch (error) {
    if (stored?.fileId) {
      await cleanupSavedFile(stored.fileId, task).catch((cleanupError) => {
        console.error(
          "[AI MediaKit] result cleanup failed",
          { taskId: String(task._id), ...safeErrorDetails(cleanupError) },
        );
      });
    }
    throw error;
  }
}

async function queryAndApplyTask(task, owner, abortController, mediaWriteLease) {
  let upstream;
  try {
    upstream = await getMediaKitVideoEnhancementTask(task.upstreamTaskId, {
      signal: AbortSignal.any([
        abortController.signal,
        AbortSignal.timeout(UPSTREAM_QUERY_TIMEOUT_MS),
      ]),
    });
  } catch (error) {
    if (abortController.signal.aborted) throw abortController.signal.reason || error;
    if (TEMPORARY_QUERY_ERROR_CODES.has(error?.code)) {
      await assertMediaWriteLeaseActive(mediaWriteLease);
      await postponeClaimedTask(task, owner);
      return;
    }
    await failClaimedTask(task, owner, error?.code, { mediaWriteLease });
    return;
  }

  if (upstream.status === "running") {
    await applyRunningResult(task, owner, upstream, mediaWriteLease);
    return;
  }
  if (upstream.status === "failed") {
    await failClaimedTask(task, owner, upstream.error?.code, { mediaWriteLease });
    return;
  }
  if (upstream.status === "canceled") {
    await failClaimedTask(task, owner, "TASK_CANCELED", { mediaWriteLease });
    return;
  }

  const finalizing = await transitionToFinalizing(task, owner, upstream, mediaWriteLease);
  if (!finalizing) return;
  try {
    await finalizeCompletedResult({
      task: finalizing,
      owner,
      upstream,
      abortController,
      mediaWriteLease,
    });
  } catch (error) {
    if (
      error instanceof MediaKitTaskLeaseLostError
      || isWriteLeaseError(error)
      || abortController.signal.aborted
    ) {
      throw error;
    }
    const resultCode = error instanceof MediaKitResultStorageError
      ? error.code
      : "RESULT_SAVE_FAILED";
    await failClaimedTask(finalizing, owner, resultCode, { mediaWriteLease });
  }
}

async function reconcileCandidate(candidate) {
  const now = new Date();
  const claimed = await claimCandidate(candidate, now);
  if (!claimed) return;
  const { task, owner } = claimed;
  const abortController = new AbortController();
  const stopHeartbeat = task.status === "submitting"
    ? async () => {}
    : startTaskLeaseHeartbeat(
        task._id,
        owner,
        task.lease?.expiresAt,
        abortController,
      );
  let stopMediaWriteLeaseMonitor = async () => {};
  let mediaWriteLease = null;
  try {
    mediaWriteLease = await beginMediaWriteLease(task.userId);
    stopMediaWriteLeaseMonitor = startMediaWriteLeaseMonitor(
      task._id,
      mediaWriteLease,
      abortController,
    );
    if (task.status === "submitting") {
      await failClaimedTask(task, owner, "TASK_FAILED", { mediaWriteLease });
      return;
    }
    if (isExpiredTask(task, now)) {
      await failClaimedTask(task, owner, "UPSTREAM_EXPIRED", { mediaWriteLease });
      return;
    }
    await queryAndApplyTask(task, owner, abortController, mediaWriteLease);
  } catch (error) {
    console.error(
      "[AI MediaKit] reconcile task failed",
      { taskId: String(task._id), ...safeErrorDetails(error) },
    );
  } finally {
    await Promise.all([
      stopHeartbeat(),
      stopMediaWriteLeaseMonitor(),
    ]);
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((error) => {
        console.error(
          "[AI MediaKit] release media write lease failed",
          { taskId: String(task._id), ...safeErrorDetails(error) },
        );
      });
    }
    await releaseTaskLease(task._id, owner).catch((error) => {
      console.error(
        "[AI MediaKit] release task lease failed",
        { taskId: String(task._id), ...safeErrorDetails(error) },
      );
    });
  }
}

export async function reconcileMediaKitVideoEnhancementTasks() {
  await dbConnect();
  const tasks = await VideoEnhancementTask.find(buildCandidateFilter(new Date()))
    .select("+upstreamTaskId")
    .sort({ nextPollAt: 1, createdAt: 1 })
    .limit(RECONCILE_BATCH_SIZE)
    .lean();
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(RECONCILE_CONCURRENCY, tasks.length) },
    async () => {
      while (cursor < tasks.length) {
        const candidate = tasks[cursor];
        cursor += 1;
        await reconcileCandidate(candidate);
      }
    },
  );
  await Promise.all(workers);
}
