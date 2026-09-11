import { generateVideo } from "@/lib/media/server/operations/video";
import { getClientIP, rateLimit } from "@/lib/rateLimit";


import {
  parseJsonRequest,
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";
import { VIDEO_MODEL_IDS } from "@/lib/media/shared/models";
import VideoGenerationTask from "@/models/VideoGenerationTask";

import { serializeVideoTask } from "@/lib/media/server/happyhorse/taskRecords";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VIDEO_TASK_RATE_LIMIT = Object.freeze({ limit: 6, windowMs: 60 * 1000 });

function jsonMessage(message, status = 400) {
  return Response.json({ success: false, message }, { status });
}

function publicMessage(error, fallback) {
  const message = error instanceof Error ? error.message : "";
  return /[\u3400-\u9fff]/u.test(message) ? message : fallback;
}

export async function GET(request) {
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    const tasks = await VideoGenerationTask.find({
      userId: user.userId,
      model: { $in: VIDEO_MODEL_IDS },
    })
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean();
    return Response.json({
      success: true,
      tasks: tasks.map(serializeVideoTask).filter(Boolean),

    });
  } catch (error) {
    console.error("[Media Video] list tasks:", error);
    return jsonMessage(publicMessage(error, "读取视频任务失败"), 500);
  }
}

export async function POST(request) {
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    if (!rateLimit(`media-video:${user.userId}:${getClientIP(request)}`, VIDEO_TASK_RATE_LIMIT).success) return jsonMessage("请求过于频繁，请稍后再试", 429);
    const parsed = await parseJsonRequest(request, "请求内容格式错误", 65536);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    const result = await generateVideo({ userId: String(user.userId), body, clientOperationId: request.headers.get("x-credit-operation-id"), signal: request.signal });
    return Response.json(result.data, { status: result.status });
  } catch (error) {
    return Response.json({ success: false, message: error.message }, { status: error.status || error.statusCode || 500 });
  }
}
