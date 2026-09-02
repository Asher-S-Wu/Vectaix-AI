import mongoose from "mongoose";
import {
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";
import { serializeVideoEnhancementTask } from "@/lib/media/server/mediaKit/taskRecords";
import { cleanupVideoEnhancementTaskDeletion } from "@/lib/media/server/mediaKit/taskDeletion";
import {
  assertMediaWriteLeaseActive,
  beginMediaWriteLease,
  endMediaWriteLease,
} from "@/lib/media/server/userOperationLeases";
import VideoEnhancementTask from "@/models/VideoEnhancementTask";
import { getCreditSummary } from "@/lib/server/credits/service";
import { syncMediaKitVideoEnhancementTask } from "@/lib/media/server/mediaKit/reconciler";
import { syncMediaTaskBillingByOperation } from "@/lib/media/server/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TERMINAL_STATUSES = Object.freeze(["completed", "failed", "canceled"]);
const ACTIVE_STATUSES = new Set(["submitting", "running", "finalizing"]);
const FINAL_BILLING_STATUSES = new Set(["settled", "released", "rejected"]);
const TASK_DELETION_CLEANUP_TIMEOUT_MS = 10 * 1000;
const PUBLIC_TASK_FIELDS = [
  "_id",
  "model",
  "status",
  "sourceType",
  "sourceName",
  "sourceHost",
  "sourceDurationSeconds",
  "sourceDurationVerified",
  "settings",
  "videoFileId",
  "result",
  "error",
  "billing",
  "createdAt",
  "updatedAt",
  "lastSyncedAt",
].join(" ");

function jsonMessage(message, status = 400) {
  return Response.json({ success: false, message }, { status });
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

function getErrorStatus(error) {
  const status = Number(error?.status ?? error?.statusCode);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

function getPublicErrorMessage(error, fallback) {
  return error?.name === "UserOperationLeaseError" ? error.message : fallback;
}

function releaseTaskDeletionLease(mediaWriteLease, taskId, label) {
  const release = endMediaWriteLease(mediaWriteLease);
  release.catch((error) => {
    console.error(label, { taskId, ...safeErrorDetails(error) });
  });
}

async function getTaskId(context) {
  const params = await context?.params;
  return typeof params?.id === "string" ? params.id.trim() : "";
}

export async function GET(request, context) {
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    const id = await getTaskId(context);
    if (!mongoose.isValidObjectId(id)) return jsonMessage("任务编号无效", 400);
    let task = await VideoEnhancementTask.findOne({
      _id: id,
      userId: user.userId,
      deletionRequestedAt: null,
    }).select(`${PUBLIC_TASK_FIELDS} +upstreamTaskId +billingPricingSnapshot +lease.owner nextPollAt`).lean();
    if (!task) return jsonMessage("视频画质增强任务不存在", 404);
    if (ACTIVE_STATUSES.has(task.status)) {
      await syncMediaKitVideoEnhancementTask(task);
      task = await VideoEnhancementTask.findOne({
        _id: id,
        userId: user.userId,
        deletionRequestedAt: null,
      }).select(PUBLIC_TASK_FIELDS).lean();
      if (!task) return jsonMessage("视频画质增强任务不存在", 404);
    }
    const serializedTask = serializeVideoEnhancementTask(task);
    const credit = await getCreditSummary(user.userId);
    return Response.json({
      success: true,
      task: serializedTask,
      billing: serializedTask?.billing ? { ...serializedTask.billing, credit } : null,
      credit,
    });
  } catch (error) {
    console.error("[AI MediaKit] get enhancement task failed", safeErrorDetails(error));
    return jsonMessage("读取视频画质增强任务失败", 500);
  }
}

export async function DELETE(request, context) {
  let mediaWriteLease = null;
  let deletionAccepted = false;
  let taskId = "";
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    const id = await getTaskId(context);
    if (!mongoose.isValidObjectId(id)) return jsonMessage("任务编号无效", 400);
    taskId = id;

    let currentTask = await VideoEnhancementTask.findOne({
      _id: id,
      userId: user.userId,
    }).select("_id userId status billing +deletionRequestedAt").lean();
    if (!currentTask) return jsonMessage("视频画质增强任务不存在", 404);
    if (ACTIVE_STATUSES.has(currentTask.status)) {
      return jsonMessage("提交中、处理中或正在保存的任务不能删除", 409);
    }
    if (
      currentTask.billing?.operationId
      && !FINAL_BILLING_STATUSES.has(currentTask.billing.status)
    ) {
      await syncMediaTaskBillingByOperation(currentTask.billing.operationId);
      currentTask = await VideoEnhancementTask.findOne({
        _id: id,
        userId: user.userId,
      }).select("_id userId status billing +deletionRequestedAt").lean();
      if (!currentTask || !FINAL_BILLING_STATUSES.has(currentTask.billing?.status)) {
        return jsonMessage(
          currentTask?.billing?.status === "review_required"
            ? "该任务的积分仍待管理员核对，暂不能删除"
            : "该任务的积分仍在结算，请稍后再删除",
          409,
        );
      }
    }

    mediaWriteLease = await beginMediaWriteLease(user.userId);
    await assertMediaWriteLeaseActive(mediaWriteLease);
    const requestedAt = new Date();
    let task = await VideoEnhancementTask.findOneAndUpdate(
      {
        _id: id,
        userId: user.userId,
        status: { $in: TERMINAL_STATUSES },
        deletionRequestedAt: null,
        $or: [
          { "billing.operationId": { $exists: false } },
          { "billing.status": { $in: Array.from(FINAL_BILLING_STATUSES) } },
        ],
      },
      { $set: { deletionRequestedAt: requestedAt } },
      { new: true, runValidators: true },
    ).select("_id userId status +deletionRequestedAt").lean();
    if (!task) {
      task = await VideoEnhancementTask.findOne({
        _id: id,
        userId: user.userId,
      }).select("_id userId status +deletionRequestedAt").lean();
      if (!task) return jsonMessage("视频画质增强任务不存在", 404);
      if (ACTIVE_STATUSES.has(task.status)) {
        return jsonMessage("提交中、处理中或正在保存的任务不能删除", 409);
      }
      if (!TERMINAL_STATUSES.includes(task.status) || !task.deletionRequestedAt) {
        return jsonMessage("当前任务状态不能删除", 409);
      }
    }

    deletionAccepted = true;
    await assertMediaWriteLeaseActive(mediaWriteLease);
    releaseTaskDeletionLease(
      mediaWriteLease,
      taskId,
      "[AI MediaKit] release task deletion intent lease failed",
    );
    mediaWriteLease = null;

    try {
      await cleanupVideoEnhancementTaskDeletion(
        { taskId: task._id, userId: task.userId },
        { timeoutMs: TASK_DELETION_CLEANUP_TIMEOUT_MS },
      );
      return Response.json({ success: true, deleted: true, cleanupPending: false });
    } catch (error) {
      console.error(
        "[AI MediaKit] delete enhancement task cleanup pending",
        { taskId, ...safeErrorDetails(error) },
      );
      return Response.json(
        {
          success: true,
          deleted: false,
          cleanupPending: true,
          message: "删除已受理，正在后台清理",
        },
        { status: 202 },
      );
    }
  } catch (error) {
    console.error(
      deletionAccepted
        ? "[AI MediaKit] delete enhancement task cleanup pending"
        : "[AI MediaKit] delete enhancement task failed",
      { taskId, ...safeErrorDetails(error) },
    );
    if (deletionAccepted) {
      return Response.json(
        {
          success: true,
          deleted: false,
          cleanupPending: true,
          message: "删除已受理，正在后台清理",
        },
        { status: 202 },
      );
    }
    return jsonMessage(
      getPublicErrorMessage(error, "删除视频画质增强任务失败"),
      getErrorStatus(error),
    );
  } finally {
    if (mediaWriteLease) {
      releaseTaskDeletionLease(
        mediaWriteLease,
        taskId,
        "[AI MediaKit] release task deletion lease failed",
      );
    }
  }
}
