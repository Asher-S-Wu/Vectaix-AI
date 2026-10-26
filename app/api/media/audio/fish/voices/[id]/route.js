import { localizedRoute } from '@/lib/server/localizedRoute';
import { clearSharedVoice } from '@/lib/server/media/settings';
import { requireUserRecord, unauthorizedResponse } from "@/lib/server/api/routeHelpers";
import { deleteFishVoice, fishErrorStatus, fishPublicMessage, getFishVoice } from "@/lib/media/server/fishAudio";
import { serializeVoice } from "@/lib/media/server/audioRecords";
import { assertMediaWriteLeaseActive, beginMediaWriteLease, endMediaWriteLease } from "@/lib/media/server/userOperationLeases";
import FishVoice from "@/models/FishVoice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function operate(request, context, remove) {
  let lease;
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    if (!auth?.payload) return unauthorizedResponse("未登录");
    const userId = String(auth.payload.userId);
    const { id } = await context.params;
    lease = await beginMediaWriteLease(userId);
    const record = await FishVoice.findOne({ userId, profileId: id });
    if (!record) return Response.json({ success: false, message: "复刻音色不存在" }, { status: 404 });
    await assertMediaWriteLeaseActive(lease);
    if (remove) {
      try {
        await deleteFishVoice(record.voiceId, { signal: request.signal });
      } catch (error) {
        if (error?.code !== "UPSTREAM_404") throw error;
      }
      await assertMediaWriteLeaseActive(lease);
      await clearSharedVoice(record.voiceId);
      await FishVoice.deleteOne({ userId, _id: record._id });
      return Response.json({ success: true, deleted: true });
    }
    const upstream = await getFishVoice(record.voiceId, { signal: request.signal });
    await assertMediaWriteLeaseActive(lease);
    record.status = upstream.state;
    record.languages = Array.isArray(upstream.languages) ? upstream.languages : [];
    record.lastStatusCheckedAt = new Date();
    await record.save();
    return Response.json({ success: true, voice: serializeVoice(record) });
  } catch (error) {
    return Response.json({ success: false, message: fishPublicMessage(error, remove ? "删除复刻音色失败" : "刷新音色状态失败") }, { status: fishErrorStatus(error) });
  } finally {
    if (lease) await endMediaWriteLease(lease).catch((error) => { console.error("[Fish Audio] release media lease:", error); });
  }
}

function GETHandler(request, context) { return operate(request, context, false); }
function DELETEHandler(request, context) { return operate(request, context, true); }

export const GET = localizedRoute(GETHandler);
export const DELETE = localizedRoute(DELETEHandler);
