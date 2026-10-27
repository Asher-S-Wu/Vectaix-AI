import { localizedRoute } from '@/lib/server/localizedRoute';
import { getClientIP, rateLimit } from "@/lib/rateLimit";
import { parseJsonRequest, requireUserRecord, unauthorizedResponse } from "@/lib/server/api/routeHelpers";
import { previewElevenLabsSpeech } from "@/lib/media/server/operations/elevenlabsSpeech";
import { elevenlabsErrorStatus, elevenlabsPublicMessage } from "@/lib/media/server/elevenlabsAudio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function POSTHandler(request) {
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    if (!auth?.payload) return unauthorizedResponse("未登录");
    const userId = String(auth.payload.userId);
    if (!rateLimit(`elevenlabs-preview:${userId}:${getClientIP(request)}`, { limit: 20, windowMs: 60000 }).success) {
      return Response.json({ success: false, message: "试听请求较多，请稍后再试" }, { status: 429 });
    }
    const parsed = await parseJsonRequest(request, "请求内容格式错误", 4096);
    if (!parsed.ok) return parsed.response;
    const result = await previewElevenLabsSpeech({ userId, body: parsed.body, clientOperationId: request.headers.get("x-credit-operation-id"), signal: request.signal });
    if (!result.audioBuffer) return Response.json(result.data, { status: result.status });
    return new Response(result.audioBuffer, { headers: { "Content-Type": result.mimeType, "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ success: false, message: elevenlabsPublicMessage(error, "音色试听失败") }, { status: elevenlabsErrorStatus(error) });
  }
}

export const POST = localizedRoute(POSTHandler);
