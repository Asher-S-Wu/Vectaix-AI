import { localizedRoute } from '@/lib/server/localizedRoute';
import { getCurrentUserWithAccess } from '@/lib/admin';
import { requireUserRecord, unauthorizedResponse } from "@/lib/server/api/routeHelpers";
import { deleteStoredFilesByOwner } from "@/lib/server/storage/service";
import { assertMediaWriteLeaseActive, beginMediaWriteLease, endMediaWriteLease } from "@/lib/media/server/userOperationLeases";
import { fishErrorStatus, fishPublicMessage } from "@/lib/media/server/fishAudio";
import FishAudioGeneration from "@/models/FishAudioGeneration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function DELETEHandler(request, context) {
  let lease;
  try {
    const access = await getCurrentUserWithAccess(request);
    if (!access?.isAdmin) return Response.json({ error: '需要管理员权限' }, { status: access ? 403 : 401 });
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    if (!auth?.payload) return unauthorizedResponse("未登录");
    const userId = String(auth.payload.userId);
    lease = await beginMediaWriteLease(userId);
    const { id } = await context.params;
    const record = await FishAudioGeneration.findOne({ userId, generationId: id }).lean();
    if (!record) return Response.json({ success: false, message: "语音记录不存在" }, { status: 404 });
    await assertMediaWriteLeaseActive(lease);
    await deleteStoredFilesByOwner({ userId, ownerType: "audio-generation", ownerId: record.generationId });
    await FishAudioGeneration.deleteOne({ userId, _id: record._id });
    return Response.json({ success: true, deleted: true });
  } catch (error) {
    return Response.json({ success: false, message: fishPublicMessage(error, "删除语音记录失败") }, { status: fishErrorStatus(error) });
  } finally {
    if (lease) await endMediaWriteLease(lease).catch((error) => { console.error("[Fish Audio] release media lease:", error); });
  }
}

export const DELETE = localizedRoute(DELETEHandler);
