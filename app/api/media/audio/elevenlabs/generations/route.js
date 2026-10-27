import mongoose from 'mongoose';
import { localizedRoute } from '@/lib/server/localizedRoute';
import { getClientIP, rateLimit } from "@/lib/rateLimit";
import { parseJsonRequest, requireUserRecord, unauthorizedResponse } from "@/lib/server/api/routeHelpers";
import { generateElevenLabsSpeech } from "@/lib/media/server/operations/elevenlabsSpeech";
import { serializeAudioGeneration } from "@/lib/media/server/audioRecords";
import { elevenlabsErrorStatus, elevenlabsPublicMessage } from "@/lib/media/server/elevenlabsAudio";
import ElevenLabsAudioGeneration from "@/models/ElevenLabsAudioGeneration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function GETHandler(request) {
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    if (!auth?.payload) return unauthorizedResponse("未登录");
    const cursor = new URL(request.url).searchParams.get('cursor');
    if (cursor && !mongoose.isValidObjectId(cursor)) return Response.json({ message: '语音记录游标无效' }, { status: 400 });
    const records = await ElevenLabsAudioGeneration.find({ userId: auth.payload.userId, ...(cursor ? { _id: { $lt: cursor } } : {}) }).sort({ _id: -1 }).limit(25).lean();
    const page = records.slice(0, 24);
    return Response.json({ success: true, generations: page.map(serializeAudioGeneration), nextCursor: records.length > 24 ? String(page.at(-1)._id) : null });
  } catch (error) {
    return Response.json({ success: false, message: elevenlabsPublicMessage(error, "读取语音记录失败") }, { status: elevenlabsErrorStatus(error) });
  }
}

async function POSTHandler(request) {
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    if (!auth?.payload) return unauthorizedResponse("未登录");
    const userId = String(auth.payload.userId);
    if (!rateLimit(`elevenlabs-generation:${userId}:${getClientIP(request)}`, { limit: 10, windowMs: 60000 }).success) {
      return Response.json({ success: false, message: "语音生成请求较多，请稍后再试" }, { status: 429 });
    }
    const parsed = await parseJsonRequest(request, "请求内容格式错误", 128 * 1024);
    if (!parsed.ok) return parsed.response;
    const result = await generateElevenLabsSpeech({ userId, body: parsed.body, clientOperationId: request.headers.get("x-credit-operation-id"), signal: request.signal });
    return Response.json(result.data, { status: result.status });
  } catch (error) {
    return Response.json({ success: false, message: elevenlabsPublicMessage(error, "语音生成失败") }, { status: elevenlabsErrorStatus(error) });
  }
}

export const GET = localizedRoute(GETHandler);
export const POST = localizedRoute(POSTHandler);
