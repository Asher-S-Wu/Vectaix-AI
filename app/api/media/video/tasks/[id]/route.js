import mongoose from "mongoose";
import {
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";
import VideoGenerationTask from "@/models/VideoGenerationTask";
import { deleteUpstreamVideoTask } from "@/lib/media/server/inferera/videos";
import {
  serializeVideoTask,
  shouldSyncVideoTask,
  syncVideoTaskRecord,
} from "@/lib/media/server/inferera/taskRecords";
import { VIDEO_MODEL } from "@/lib/media/shared/models";
import { deleteStoredFilesByOwner } from "@/lib/server/storage/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonMessage(message, status = 400) {
  return Response.json({ success: false, message }, { status });
}

function getPublicErrorMessage(error, fallback) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("AIHUBMIX_API_KEY")) {
    return "缺少 AIHUBMIX_API_KEY 环境变量";
  }
  return message || fallback;
}

async function getTaskId(context) {
  const params = await context?.params;
  return typeof params?.id === "string" ? params.id.trim() : "";
}

async function loadOwnedTask(id, userId) {
  if (!mongoose.isValidObjectId(id)) return null;
  return VideoGenerationTask.findOne({ _id: id, userId, model: VIDEO_MODEL });
}

export async function GET(request, context) {
  try {
    const auth = await requireUserRecord({ connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");

    const id = await getTaskId(context);
    let task = await loadOwnedTask(id, user.userId);
    if (!task) {
      return jsonMessage("任务不存在", 404);
    }

    if (shouldSyncVideoTask(task)) {
      task = await syncVideoTaskRecord(task, { signal: request.signal });
    } else {
      task = task.toObject();
    }

    return Response.json({
      success: true,
      task: serializeVideoTask(task),
    });
  } catch (error) {
    console.error("[Media] get video task:", error);
    const message = getPublicErrorMessage(error, "查询视频任务失败");
    const status = Number.isInteger(error?.status) && error.status >= 400 ? error.status : 500;
    return jsonMessage(message, status);
  }
}

export async function DELETE(request, context) {
  try {
    const auth = await requireUserRecord({ connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");

    const id = await getTaskId(context);
    const task = await loadOwnedTask(id, user.userId);
    if (!task) {
      return jsonMessage("任务不存在", 404);
    }

    if (task.status === "in_progress") {
      return jsonMessage("生成中的任务暂时不能删除", 409);
    }
    await deleteUpstreamVideoTask(task.upstreamTaskId, { signal: request.signal });
    await deleteStoredFilesByOwner({
      userId: user.userId,
      ownerType: "video-task",
      ownerId: task._id,
    });
    await VideoGenerationTask.deleteOne({ _id: task._id, userId: user.userId, model: VIDEO_MODEL });
    return Response.json({ success: true, deleted: true });
  } catch (error) {
    console.error("[Media] delete video task:", error);
    const message = getPublicErrorMessage(error, "处理视频任务失败");
    const status = Number.isInteger(error?.status) && error.status >= 400 ? error.status : 500;
    return jsonMessage(message, status);
  }
}
