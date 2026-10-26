import mongoose from 'mongoose';
import { localizedRoute } from '@/lib/server/localizedRoute';
import { getClientIP, rateLimit } from "@/lib/rateLimit";
import { parseJsonRequest, requireUserRecord, unauthorizedResponse } from "@/lib/server/api/routeHelpers";
import { generateQwenSpeech } from "@/lib/media/server/operations/qwenSpeech";
import { serializeAudioGeneration } from "@/lib/media/server/audioRecords";
import { qwenErrorStatus, qwenPublicMessage } from "@/lib/media/server/qwenAudio";
import QwenAudioGeneration from "@/models/QwenAudioGeneration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function GETHandler(request) {
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    if (!auth?.payload) return unauthorizedResponse("未登录");
    const cursor = new URL(request.url).searchParams.get('cursor');
    if (cursor && !mongoose.isValidObjectId(cursor)) return Response.json({ message: '语音记录游标无效' }, { status: 400 });
    const records = await QwenAudioGeneration.find({ userId: auth.payload.userId, ...(cursor ? { _id: { $lt: cursor } } : {}) }).sort({ _id: -1 }).limit(25).lean();
    const page = records.slice(0, 24);
    return Response.json({ success: true, generations: page.map(serializeAudioGeneration), nextCursor: records.length > 24 ? String(page.at(-1)._id) : null });
  } catch (error) {
    return Response.json({ success: false, message: qwenPublicMessage(error, "读取语音记录失败") }, { status: qwenErrorStatus(error) });
  }
}

async function POSTHandler(request) {
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    if (!auth?.payload) return unauthorizedResponse("未登录");
    const userId = String(auth.payload.userId);
    if (!rateLimit(`qwen-generation:${userId}:${getClientIP(request)}`, { limit: 10, windowMs: 60000 }).success) {
      return Response.json({ success: false, message: "语音生成请求较多，请稍后再试" }, { status: 429 });
    }
    const parsed = await parseJsonRequest(request, "请求内容格式错误", 128 * 1024);
    if (!parsed.ok) return parsed.response;
    const result = await generateQwenSpeech({ userId, body: parsed.body, clientOperationId: request.headers.get("x-credit-operation-id"), signal: request.signal });
    return Response.json(result.data, { status: result.status });
  } catch (error) {
    return Response.json({ success: false, message: qwenPublicMessage(error, "语音生成失败") }, { status: qwenErrorStatus(error) });
  }
}

export const GET = localizedRoute(GETHandler);
export const POST = localizedRoute(POSTHandler);
