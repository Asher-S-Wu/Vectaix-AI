import mongoose from "mongoose";
import {
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";
import VideoGenerationTask from "@/models/VideoGenerationTask";
import {
  serializeVideoTask,
  failStaleUnsubmittedTask,
  failStaleFinalizingTask,
  isStaleFinalizingTask,
  isStaleUnsubmittedTask,
  shouldSyncVideoTask,
  syncVideoTaskRecord,
} from "@/lib/media/server/happyhorse/taskRecords";
import { VIDEO_MODEL_IDS } from "@/lib/media/shared/models";
import { deleteStoredFilesByOwner } from "@/lib/server/storage/service";
import { getCreditSummary } from "@/lib/server/credits/service";
import {
  assertMediaWriteLeaseActive,
  beginMediaWriteLease,
  endMediaWriteLease,
} from "@/lib/media/server/userOperationLeases";
import { syncMediaTaskBillingByOperation } from "@/lib/media/server/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UPSTREAM_QUERY_TIMEOUT_MS = 30 * 1000;
const FINAL_BILLING_STATUSES = new Set(["settled", "released", "rejected"]);

function jsonMessage(message, status = 400) {
  return Response.json({ success: false, message }, { status });
}

function publicMessage(error, fallback) {
  const message = error instanceof Error ? error.message : "";
  return /[\u3400-\u9fff]/u.test(message) ? message : fallback;
}

async function getTaskId(context) {
  const params = await context?.params;
  return typeof params?.id === "string" ? params.id.trim() : "";
}

async function loadOwnedTask(id, userId) {
  if (!mongoose.isValidObjectId(id)) return null;
  return VideoGenerationTask.findOne({
    _id: id,
    userId,
    model: { $in: VIDEO_MODEL_IDS },
  }).select("+billingPricingSnapshot");
}

export async function GET(request, context) {
  let mediaWriteLease = null;
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    let task = await loadOwnedTask(await getTaskId(context), user.userId);
    if (!task) return jsonMessage("任务不存在", 404);

    let current = task;
    if (isStaleUnsubmittedTask(task)) {
      mediaWriteLease = await beginMediaWriteLease(user.userId);
      current = await failStaleUnsubmittedTask(task, { mediaWriteLease });
    } else if (isStaleFinalizingTask(task)) {
      mediaWriteLease = await beginMediaWriteLease(user.userId);
      current = await failStaleFinalizingTask(task, { mediaWriteLease });
    } else if (shouldSyncVideoTask(task)) {
      mediaWriteLease = await beginMediaWriteLease(user.userId);
      current = await syncVideoTaskRecord(task, {
        signal: AbortSignal.any([
          request.signal,
          AbortSignal.timeout(UPSTREAM_QUERY_TIMEOUT_MS),
        ]),
        mediaWriteLease,
      });
    }
    const serializedTask = serializeVideoTask(current);
    const credit = await getCreditSummary(user.userId);
    return Response.json({
      success: true,
      task: serializedTask,
      billing: serializedTask?.billing ? { ...serializedTask.billing, credit } : null,
      credit,
    });
  } catch (error) {
    console.error("[Media Video] get task:", error);
    const status = Number.isInteger(error?.status)
      ? error.status
      : Number.isInteger(error?.statusCode)
        ? error.statusCode
        : 500;
    return jsonMessage(publicMessage(error, "查询视频任务失败"), status);
  } finally {
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((error) => {
        console.error("[Media Video] release sync write lease:", error);
      });
    }
  }
}

export async function DELETE(request, context) {
  let mediaWriteLease = null;
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    const task = await loadOwnedTask(await getTaskId(context), user.userId);
    if (!task) return jsonMessage("任务不存在", 404);
    if (["queued", "in_progress", "finalizing"].includes(task.status)) {
      return jsonMessage("排队中、生成中或正在保存的任务不能删除", 409);
    }
    if (task.billing?.operationId && !FINAL_BILLING_STATUSES.has(task.billing.status)) {
      await syncMediaTaskBillingByOperation(task.billing.operationId);
      task = await loadOwnedTask(task._id, user.userId);
      if (!task || !FINAL_BILLING_STATUSES.has(task.billing?.status)) {
        return jsonMessage(
          task?.billing?.status === "review_required"
            ? "该任务的积分仍待管理员核对，暂不能删除"
            : "该任务的积分仍在结算，请稍后再删除",
          409,
        );
      }
    }

    mediaWriteLease = await beginMediaWriteLease(user.userId);
    await assertMediaWriteLeaseActive(mediaWriteLease);
    await deleteStoredFilesByOwner({
      userId: user.userId,
      ownerType: "video-task",
      ownerId: task._id,
    });
    await VideoGenerationTask.deleteOne({ _id: task._id, userId: user.userId });
    return Response.json({ success: true, deleted: true });
  } catch (error) {
    console.error("[Media Video] delete task:", error);
    const status = Number.isInteger(error?.status)
      ? error.status
      : Number.isInteger(error?.statusCode)
        ? error.statusCode
        : 500;
    return jsonMessage(publicMessage(error, "删除视频任务失败"), status);
  } finally {
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((error) => {
        console.error("[Media Video] release delete write lease:", error);
      });
    }
  }
}
