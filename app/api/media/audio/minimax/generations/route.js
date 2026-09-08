import { generateMinimaxSpeech } from "@/lib/media/server/operations/minimaxSpeech";

import { getClientIP, rateLimit } from "@/lib/rateLimit";
import {
  parseJsonRequest,
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";

import { serializeMinimaxAudioGeneration } from "@/lib/media/server/minimaxAudioRecords";

import MinimaxAudioGeneration from "@/models/MinimaxAudioGeneration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GENERATION_RATE_LIMIT = Object.freeze({ limit: 10, windowMs: 60 * 1000 });

function jsonMessage(message, status = 400) {
  return Response.json({ success: false, message }, { status });
}

function errorStatus(error, fallback = 500) {
  const status = Number(error?.status ?? error?.statusCode);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : fallback;
}

function publicMessage(error, fallback) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("DASHSCOPE_BEIJING_API_KEY")) return "MiniMax 北京区域密钥尚未配置";
  return /[\u3400-\u9fff]/u.test(message) ? message : fallback;
}

export async function GET(request) {
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    const generations = await MinimaxAudioGeneration.find({ userId: user.userId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(100)
      .lean();
    return Response.json({
      success: true,
      generations: generations.map(serializeMinimaxAudioGeneration).filter(Boolean),
    });
  } catch (error) {
    console.error("[MiniMax Audio] list generations:", error);
    return jsonMessage(publicMessage(error, "读取 MiniMax 语音记录失败"), errorStatus(error));
  }
}

export async function POST(request) {
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    if (!rateLimit(`media-minimax-audio-generation:${user.userId}:${getClientIP(request)}`, GENERATION_RATE_LIMIT).success) return jsonMessage("语音生成请求过于频繁，请稍后再试", 429);
    const parsed = await parseJsonRequest(request, "请求内容格式错误", 131072);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    const result = await generateMinimaxSpeech({ userId: String(user.userId), body, clientOperationId: request.headers.get("x-credit-operation-id"), signal: request.signal });
    return Response.json(result.data, { status: result.status });
  } catch (error) {
    return Response.json({ success: false, message: error.message }, { status: error.status || error.statusCode || 500 });
  }
}
