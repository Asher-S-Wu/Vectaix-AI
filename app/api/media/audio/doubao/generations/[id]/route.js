import {
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";
import { DOUBAO_AUDIO_MODEL } from "@/lib/media/shared/doubaoAudio";
import { serializeDoubaoAudioGeneration } from "@/lib/media/server/doubaoAudioRecords";
import {
  assertMediaWriteLeaseActive,
  beginMediaWriteLease,
  endMediaWriteLease,
} from "@/lib/media/server/userOperationLeases";
import { deleteStoredFilesByOwner } from "@/lib/server/storage/service";
import DoubaoAudioGeneration from "@/models/DoubaoAudioGeneration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonMessage(message, status = 400) {
  return Response.json({ success: false, message }, { status });
}

function publicMessage(error, fallback) {
  const message = error instanceof Error ? error.message : "";
  return /[\u3400-\u9fff]/u.test(message) ? message : fallback;
}

function getErrorStatus(error) {
  const status = Number(error?.status);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

async function getGenerationId(context) {
  const params = await context?.params;
  return typeof params?.id === "string" ? params.id.trim() : "";
}

export async function GET(_request, context) {
  try {
    const auth = await requireUserRecord({ connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    const generationId = await getGenerationId(context);
    const generation = await DoubaoAudioGeneration.findOne({
      generationId,
      userId: user.userId,
      model: DOUBAO_AUDIO_MODEL,
    }).select("+subtitle").lean();
    if (!generation) return jsonMessage("Doubao 音频记录不存在", 404);
    return Response.json({
      success: true,
      generation: serializeDoubaoAudioGeneration(generation, { includeSubtitle: true }),
    });
  } catch (error) {
    console.error("[Doubao Audio] get generation:", error);
    return jsonMessage(publicMessage(error, "读取 Doubao 音频记录失败"), getErrorStatus(error));
  }
}

export async function DELETE(_request, context) {
  let mediaWriteLease = null;
  try {
    const auth = await requireUserRecord({ connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    mediaWriteLease = await beginMediaWriteLease(user.userId);
    const generationId = await getGenerationId(context);
    const generation = await DoubaoAudioGeneration.findOne({
      generationId,
      userId: user.userId,
      model: DOUBAO_AUDIO_MODEL,
    });
    if (!generation) return jsonMessage("Doubao 音频记录不存在", 404);

    await assertMediaWriteLeaseActive(mediaWriteLease);
    await deleteStoredFilesByOwner({
      userId: user.userId,
      ownerType: "audio-generation",
      ownerId: generation.generationId,
    });
    await DoubaoAudioGeneration.deleteOne({ _id: generation._id, userId: user.userId });
    return Response.json({ success: true, deleted: true });
  } catch (error) {
    console.error("[Doubao Audio] delete generation:", error);
    return jsonMessage(publicMessage(error, "删除 Doubao 音频记录失败"), getErrorStatus(error));
  } finally {
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((error) => {
        console.error("[Doubao Audio] release media write lease:", error);
      });
    }
  }
}
