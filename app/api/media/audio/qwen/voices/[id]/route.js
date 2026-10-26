import { localizedRoute } from '@/lib/server/localizedRoute';
import { getCurrentUserWithAccess } from '@/lib/admin';
import { clearSharedVoice } from '@/lib/server/media/settings';
import { requireUserRecord, unauthorizedResponse } from "@/lib/server/api/routeHelpers";
import { deleteQwenVoice, qwenErrorStatus, qwenPublicMessage, getQwenVoice } from "@/lib/media/server/qwenAudio";
import { serializeVoice } from "@/lib/media/server/audioRecords";
import { assertMediaWriteLeaseActive, beginMediaWriteLease, endMediaWriteLease } from "@/lib/media/server/userOperationLeases";
import QwenVoice from "@/models/QwenVoice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function operate(request, context, remove) {
  let lease;
  try {
    const access = await getCurrentUserWithAccess(request);
    if (!access?.isAdmin) return Response.json({ error: '需要管理员权限' }, { status: access ? 403 : 401 });
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    if (!auth?.payload) return unauthorizedResponse("未登录");
    const userId = String(auth.payload.userId);
    const { id } = await context.params;
    lease = await beginMediaWriteLease(userId);
    const record = await QwenVoice.findOne({ userId, profileId: id });
    if (!record) return Response.json({ success: false, message: "复刻音色不存在" }, { status: 404 });
    await assertMediaWriteLeaseActive(lease);
    if (remove) {
      await deleteQwenVoice(record.voiceId, { signal: request.signal });
      await assertMediaWriteLeaseActive(lease);
      await clearSharedVoice(record.voiceId);
      await QwenVoice.deleteOne({ userId, _id: record._id });
      return Response.json({ success: true, deleted: true });
    }
    const upstream = await getQwenVoice(record.voiceId, { signal: request.signal });
    await assertMediaWriteLeaseActive(lease);
    record.status = upstream.state;
    record.languages = Array.isArray(upstream.languages) ? upstream.languages : [];
    record.lastStatusCheckedAt = new Date();
    await record.save();
    return Response.json({ success: true, voice: serializeVoice(record) });
  } catch (error) {
    return Response.json({ success: false, message: qwenPublicMessage(error, remove ? "删除复刻音色失败" : "刷新音色状态失败") }, { status: qwenErrorStatus(error) });
  } finally {
    if (lease) await endMediaWriteLease(lease).catch((error) => { console.error("[Qwen Audio] release media lease:", error); });
  }
}

function GETHandler(request, context) { return operate(request, context, false); }
function DELETEHandler(request, context) { return operate(request, context, true); }

export const GET = localizedRoute(GETHandler);
export const DELETE = localizedRoute(DELETEHandler);
