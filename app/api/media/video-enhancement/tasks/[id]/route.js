import mongoose from "mongoose";
import {
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";
import { serializeVideoEnhancementTask } from "@/lib/media/server/mediaKit/taskRecords";
import {
  assertMediaWriteLeaseActive,
  beginMediaWriteLease,
  endMediaWriteLease,
} from "@/lib/media/server/userOperationLeases";
import { deleteStoredFilesByOwner } from "@/lib/server/storage/service";
import VideoEnhancementTask from "@/models/VideoEnhancementTask";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TERMINAL_STATUSES = Object.freeze(["completed", "failed", "canceled"]);
const ACTIVE_STATUSES = new Set(["submitting", "running", "finalizing"]);
const PUBLIC_TASK_FIELDS = [
  "_id",
  "model",
  "status",
  "sourceType",
  "sourceName",
  "sourceHost",
  "settings",
  "videoFileId",
  "result",
  "error",
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

async function getTaskId(context) {
  const params = await context?.params;
  return typeof params?.id === "string" ? params.id.trim() : "";
}

export async function GET(_request, context) {
  try {
    const auth = await requireUserRecord({ connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    const id = await getTaskId(context);
    if (!mongoose.isValidObjectId(id)) return jsonMessage("任务编号无效", 400);
    const task = await VideoEnhancementTask.findOne({
      _id: id,
      userId: user.userId,
    }).select(PUBLIC_TASK_FIELDS).lean();
    if (!task) return jsonMessage("视频画质增强任务不存在", 404);
    return Response.json({ success: true, task: serializeVideoEnhancementTask(task) });
  } catch (error) {
    console.error("[AI MediaKit] get enhancement task failed", safeErrorDetails(error));
    return jsonMessage("读取视频画质增强任务失败", 500);
  }
}

export async function DELETE(_request, context) {
  let mediaWriteLease = null;
  try {
    const auth = await requireUserRecord({ connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    const id = await getTaskId(context);
    if (!mongoose.isValidObjectId(id)) return jsonMessage("任务编号无效", 400);

    mediaWriteLease = await beginMediaWriteLease(user.userId);
    await assertMediaWriteLeaseActive(mediaWriteLease);
    const task = await VideoEnhancementTask.findOne({
      _id: id,
      userId: user.userId,
    }).select("_id status").lean();
    if (!task) return jsonMessage("视频画质增强任务不存在", 404);
    if (ACTIVE_STATUSES.has(task.status)) {
      return jsonMessage("提交中、处理中或正在保存的任务不能删除", 409);
    }
    if (!TERMINAL_STATUSES.includes(task.status)) {
      return jsonMessage("当前任务状态不能删除", 409);
    }

    await assertMediaWriteLeaseActive(mediaWriteLease);
    await deleteStoredFilesByOwner({
      userId: user.userId,
      ownerType: "video-enhancement-task",
      ownerId: task._id,
    });
    await assertMediaWriteLeaseActive(mediaWriteLease);
    const deleted = await VideoEnhancementTask.deleteOne({
      _id: task._id,
      userId: user.userId,
      status: { $in: TERMINAL_STATUSES },
    });
    if (deleted.deletedCount !== 1) {
      return jsonMessage("任务状态已变化，无法删除", 409);
    }
    return Response.json({ success: true, deleted: true });
  } catch (error) {
    console.error("[AI MediaKit] delete enhancement task failed", safeErrorDetails(error));
    return jsonMessage(
      getPublicErrorMessage(error, "删除视频画质增强任务失败"),
      getErrorStatus(error),
    );
  } finally {
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((error) => {
        console.error("[AI MediaKit] release task deletion lease failed", safeErrorDetails(error));
      });
    }
  }
}
