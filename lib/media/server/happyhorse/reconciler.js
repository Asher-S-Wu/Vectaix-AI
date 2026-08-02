import dbConnect from "@/lib/db";
import VideoGenerationTask from "@/models/VideoGenerationTask";
import { VIDEO_ACTIVE_STATUSES } from "@/lib/media/server/happyhorse/videos";
import {
  failStaleFinalizingTask,
  failStaleUnsubmittedTask,
  isStaleFinalizingTask,
  isStaleUnsubmittedTask,
  shouldSyncVideoTask,
  syncVideoTaskRecord,
} from "@/lib/media/server/happyhorse/taskRecords";
import { VIDEO_MODEL_IDS } from "@/lib/media/shared/models";
import {
  beginMediaWriteLease,
  endMediaWriteLease,
} from "@/lib/media/server/userOperationLeases";

const RECONCILE_BATCH_SIZE = 12;
const RECONCILE_CONCURRENCY = 3;
const UNSUBMITTED_STALE_MS = 10 * 60 * 1000;
const FINALIZATION_STALE_MS = 20 * 60 * 1000;
const UPSTREAM_QUERY_TIMEOUT_MS = 30 * 1000;

function buildCandidateFilter(now) {
  return {
    model: { $in: VIDEO_MODEL_IDS },
    $or: [
      {
        status: { $in: [...VIDEO_ACTIVE_STATUSES] },
        upstreamTaskId: { $type: "string", $ne: "" },
      },
      {
        status: "queued",
        upstreamTaskId: null,
        createdAt: { $lte: new Date(now.getTime() - UNSUBMITTED_STALE_MS) },
      },
      {
        status: "finalizing",
        finalizationStartedAt: { $lte: new Date(now.getTime() - FINALIZATION_STALE_MS) },
      },
    ],
  };
}

async function reconcileTask(task) {
  let mediaWriteLease = null;
  try {
    mediaWriteLease = await beginMediaWriteLease(task.userId);
    if (isStaleUnsubmittedTask(task)) {
      await failStaleUnsubmittedTask(task, { mediaWriteLease });
    } else if (isStaleFinalizingTask(task)) {
      await failStaleFinalizingTask(task, { mediaWriteLease });
    } else if (shouldSyncVideoTask(task)) {
      await syncVideoTaskRecord(task, {
        signal: AbortSignal.timeout(UPSTREAM_QUERY_TIMEOUT_MS),
        mediaWriteLease,
      });
    }
  } catch (error) {
    console.error("[Media Video] scheduled reconcile task:", {
      taskId: String(task?._id || ""),
      errorType: error?.name || "Error",
      code: error?.code || "",
    });
  } finally {
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((error) => {
        console.error("[Media Video] release scheduled write lease:", error);
      });
    }
  }
}

export async function reconcileHappyHorseVideoTasks() {
  await dbConnect();
  const tasks = await VideoGenerationTask.find(buildCandidateFilter(new Date()))
    .sort({ upstreamPolledAt: 1, createdAt: 1 })
    .limit(RECONCILE_BATCH_SIZE)
    .lean();
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(RECONCILE_CONCURRENCY, tasks.length) },
    async () => {
      while (cursor < tasks.length) {
        const task = tasks[cursor];
        cursor += 1;
        await reconcileTask(task);
      }
    },
  );
  await Promise.all(workers);
}
