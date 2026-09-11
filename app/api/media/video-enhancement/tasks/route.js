import { enhanceVideo } from "@/lib/media/server/operations/enhancement";
import { getClientIP, rateLimit } from "@/lib/rateLimit";


import {
  parseJsonRequest,
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";

import { serializeVideoEnhancementTask } from "@/lib/media/server/mediaKit/taskRecords";

import VideoEnhancementTask from "@/models/VideoEnhancementTask";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const USER_RATE_LIMIT = Object.freeze({ limit: 6, windowMs: 60 * 1000 });
const IP_RATE_LIMIT = Object.freeze({ limit: 18, windowMs: 60 * 1000 });
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

function isRateLimited(request, userId) {
  const ip = getClientIP(request);
  const userLimit = rateLimit(`media-video-enhancement-task:user:${userId}`, USER_RATE_LIMIT);
  const ipLimit = rateLimit(`media-video-enhancement-task:ip:${ip}`, IP_RATE_LIMIT);
  return !userLimit.success || !ipLimit.success;
}

export async function GET(request) {
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    const tasks = await VideoEnhancementTask.find({
      userId: user.userId,
      deletionRequestedAt: null,
    })
      .select(PUBLIC_TASK_FIELDS)
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean();
    return Response.json({
      success: true,
      tasks: tasks.map(serializeVideoEnhancementTask).filter(Boolean),

    });
  } catch (error) {
    console.error("[AI MediaKit] list enhancement tasks failed", safeErrorDetails(error));
    return jsonMessage("读取视频画质增强任务失败", 500);
  }
}

export async function POST(request) {
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    if (isRateLimited(request, user.userId)) return jsonMessage("视频画质增强请求过于频繁，请稍后再试", 429);
    const parsed = await parseJsonRequest(request, "请求内容格式错误", 32768);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    const result = await enhanceVideo({ userId: String(user.userId), body, clientOperationId: request.headers.get("x-credit-operation-id"), signal: request.signal });
    return Response.json(result.data, { status: result.status });
  } catch (error) {
    return Response.json({ success: false, message: error.message }, { status: error.status || error.statusCode || 500 });
  }
}
