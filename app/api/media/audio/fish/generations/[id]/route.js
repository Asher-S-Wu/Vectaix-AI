import StoredFile from '@/models/StoredFile';
import { withProjectLock } from '@/lib/server/workbench/projectLock';
import { assertStoredFilesUnreferenced } from '@/lib/server/storage/references';
import { localizedRoute } from '@/lib/server/localizedRoute';
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
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    if (!auth?.payload) return unauthorizedResponse("未登录");
    const userId = String(auth.payload.userId);
    lease = await beginMediaWriteLease(userId);
    return await withProjectLock(userId, 'task-creation', async () => {
    const { id } = await context.params;
    const record = await FishAudioGeneration.findOne({ userId, generationId: id }).lean();
    if (!record) return Response.json({ success: false, message: "语音记录不存在" }, { status: 404 });
    const files = await StoredFile.find({ userId, ownerType: 'audio-generation', ownerId: record.generationId }).lean();
    await assertStoredFilesUnreferenced(userId, files);
    await assertMediaWriteLeaseActive(lease);
    await deleteStoredFilesByOwner({ userId, ownerType: "audio-generation", ownerId: record.generationId });
    await FishAudioGeneration.deleteOne({ userId, _id: record._id });
    return Response.json({ success: true, deleted: true });
    });
  } catch (error) {
    return Response.json({ success: false, message: fishPublicMessage(error, "删除语音记录失败") }, { status: fishErrorStatus(error) });
  } finally {
    if (lease) await endMediaWriteLease(lease).catch((error) => { console.error("[Fish Audio] release media lease:", error); });
  }
}

export const DELETE = localizedRoute(DELETEHandler);
