import StoredFile from '@/models/StoredFile';
import { withProjectLock } from '@/lib/server/workbench/projectLock';
import { assertStoredFilesUnreferenced } from '@/lib/server/storage/references';
import { localizedRoute } from '@/lib/server/localizedRoute';
import { requireUserRecord, unauthorizedResponse } from "@/lib/server/api/routeHelpers";
import { deleteStoredFilesByOwner } from "@/lib/server/storage/service";
import { assertMediaWriteLeaseActive, beginMediaWriteLease, endMediaWriteLease } from "@/lib/media/server/userOperationLeases";
import { elevenlabsErrorStatus, elevenlabsPublicMessage } from "@/lib/media/server/elevenlabsAudio";
import ElevenLabsAudioGeneration from "@/models/ElevenLabsAudioGeneration";

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
    const record = await ElevenLabsAudioGeneration.findOne({ userId, generationId: id }).lean();
    if (!record) return Response.json({ success: false, message: "语音记录不存在" }, { status: 404 });
    const files = await StoredFile.find({ userId, ownerType: 'audio-generation', ownerId: record.generationId }).lean();
    await assertStoredFilesUnreferenced(userId, files);
    await assertMediaWriteLeaseActive(lease);
    await deleteStoredFilesByOwner({ userId, ownerType: "audio-generation", ownerId: record.generationId });
    await ElevenLabsAudioGeneration.deleteOne({ userId, _id: record._id });
    return Response.json({ success: true, deleted: true });
    });
  } catch (error) {
    return Response.json({ success: false, message: elevenlabsPublicMessage(error, "删除语音记录失败") }, { status: elevenlabsErrorStatus(error) });
  } finally {
    if (lease) await endMediaWriteLease(lease).catch((error) => { console.error("[ElevenLabs] release media lease:", error); });
  }
}

export const DELETE = localizedRoute(DELETEHandler);
