import { localizedRoute } from '@/lib/server/localizedRoute';
import { getCurrentUserWithAccess } from '@/lib/admin';
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
    const access = await getCurrentUserWithAccess(request);
    if (!access?.isAdmin) return Response.json({ error: '需要管理员权限' }, { status: access ? 403 : 401 });
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    if (!auth?.payload) return unauthorizedResponse("未登录");
    const records = await QwenAudioGeneration.find({ userId: auth.payload.userId }).sort({ createdAt: -1, _id: -1 }).limit(100).lean();
    return Response.json({ success: true, generations: records.map(serializeAudioGeneration) });
  } catch (error) {
    return Response.json({ success: false, message: qwenPublicMessage(error, "读取语音记录失败") }, { status: qwenErrorStatus(error) });
  }
}

async function POSTHandler(request) {
  try {
    const access = await getCurrentUserWithAccess(request);
    if (!access?.isAdmin) return Response.json({ error: '需要管理员权限' }, { status: access ? 403 : 401 });
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
