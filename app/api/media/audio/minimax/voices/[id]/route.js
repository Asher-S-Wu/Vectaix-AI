import { localizedRoute } from '@/lib/server/localizedRoute';
import { clearSharedVoice } from '@/lib/server/media/settings';
import { requireUserRecord, unauthorizedResponse } from "@/lib/server/api/routeHelpers";
import { deleteMiniMaxVoice, listMiniMaxVoices, minimaxErrorStatus, minimaxPublicMessage } from "@/lib/media/server/minimaxAudio";
import { serializeMiniMaxVoice } from "@/lib/media/server/audioRecords";
import { assertMediaWriteLeaseActive, beginMediaWriteLease, endMediaWriteLease } from "@/lib/media/server/userOperationLeases";
import MiniMaxVoice from "@/models/MiniMaxVoice";

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
    const record = await MiniMaxVoice.findOne({ userId, profileId: id });
    if (!record) return Response.json({ success: false, message: "复刻音色不存在" }, { status: 404 });
    await assertMediaWriteLeaseActive(lease);
    if (remove) {
      try {
        await deleteMiniMaxVoice(record.voiceId, { signal: request.signal });
      } catch (error) {
        if (error?.code !== "MINIMAX_2054") throw error;
      }
      await assertMediaWriteLeaseActive(lease);
      await clearSharedVoice('minimax', record.voiceId);
      await MiniMaxVoice.deleteOne({ userId, _id: record._id });
      return Response.json({ success: true, deleted: true });
    }
    // MiniMax only lists a cloned voice after it has been used for synthesis once.
    if (!record.activatedAt && (await listMiniMaxVoices('voice_cloning', { signal: request.signal })).some(voice => voice.voice_id === record.voiceId)) {
      record.activatedAt = new Date();
    }
    await assertMediaWriteLeaseActive(lease);
    record.lastStatusCheckedAt = new Date();
    await record.save();
    return Response.json({ success: true, voice: serializeMiniMaxVoice(record) });
  } catch (error) {
    return Response.json({ success: false, message: minimaxPublicMessage(error, remove ? "删除复刻音色失败" : "刷新音色状态失败") }, { status: minimaxErrorStatus(error) });
  } finally {
    if (lease) await endMediaWriteLease(lease).catch((error) => { console.error("[MiniMax] release media lease:", error); });
  }
}

function GETHandler(request, context) { return operate(request, context, false); }
function DELETEHandler(request, context) { return operate(request, context, true); }

export const GET = localizedRoute(GETHandler);
export const DELETE = localizedRoute(DELETEHandler);
