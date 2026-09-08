import { generateQwenSpeech } from "@/lib/media/server/operations/qwenSpeech";
import { parseJsonRequest } from "@/lib/server/api/routeHelpers";

import { getClientIP, rateLimit } from "@/lib/rateLimit";
import {
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";
import { AUDIO_MODEL } from "@/lib/media/shared/models";

import { serializeAudioGeneration } from "@/lib/media/server/audioRecords";

import AudioGeneration from "@/models/AudioGeneration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GENERATION_RATE_LIMIT = Object.freeze({ limit: 10, windowMs: 60 * 1000 });

function jsonMessage(message, status = 400) {
  return Response.json({ success: false, message }, { status });
}

function getErrorStatus(error, fallback = 500) {
  const status = Number(error?.status);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : fallback;
}

function getPublicErrorMessage(error, fallback) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("DASHSCOPE_SINGAPORE_API_KEY")) {
    return "语音服务密钥尚未配置";
  }
  return /[\u3400-\u9fff]/u.test(message) ? message : fallback;
}

export async function GET(request) {
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");

    const generations = await AudioGeneration.find({
      userId: user.userId,
      model: AUDIO_MODEL,
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(100)
      .lean();

    return Response.json({
      success: true,
      generations: generations.map(serializeAudioGeneration).filter(Boolean),
    });
  } catch (error) {
    console.error("[Media Audio] list generations:", error);
    return jsonMessage(getPublicErrorMessage(error, "读取语音记录失败"), getErrorStatus(error));
  }
}

export async function POST(request) {
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    if (!rateLimit(`media-audio-generation:${user.userId}:${getClientIP(request)}`, GENERATION_RATE_LIMIT).success) return jsonMessage("语音生成请求过于频繁，请稍后再试", 429);
    const parsed = await parseJsonRequest(request, "请求内容格式错误", 262144);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    const result = await generateQwenSpeech({ userId: String(user.userId), body, clientOperationId: request.headers.get("x-credit-operation-id"), signal: request.signal });
    return Response.json(result.data, { status: result.status });
  } catch (error) {
    return Response.json({ success: false, message: error.message }, { status: error.status || error.statusCode || 500 });
  }
}
