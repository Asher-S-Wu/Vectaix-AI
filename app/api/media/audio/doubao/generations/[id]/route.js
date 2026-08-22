import {
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";
import { DOUBAO_AUDIO_MODEL } from "@/lib/media/shared/doubaoAudio";
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

async function readGenerationId(context) {
  const params = await context?.params;
  return typeof params?.id === "string" ? params.id.trim() : "";
}

export async function DELETE(_request, context) {
  let mediaWriteLease = null;
  try {
    const auth = await requireUserRecord({ connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    mediaWriteLease = await beginMediaWriteLease(user.userId);
    const generationId = await readGenerationId(context);
    const generation = await DoubaoAudioGeneration.findOne({
      userId: user.userId,
      generationId,
      model: DOUBAO_AUDIO_MODEL,
    });
    if (!generation) return jsonMessage("豆包语音记录不存在", 404);
    await assertMediaWriteLeaseActive(mediaWriteLease);
    await deleteStoredFilesByOwner({
      userId: user.userId,
      ownerType: "audio-generation",
      ownerId: generation.generationId,
    });
    await DoubaoAudioGeneration.deleteOne({
      _id: generation._id,
      userId: user.userId,
      generationId: generation.generationId,
      model: DOUBAO_AUDIO_MODEL,
    });
    return Response.json({ success: true, deleted: true });
  } catch (error) {
    console.error("[Doubao Audio] delete generation:", error);
    const status = Number(error?.status ?? error?.statusCode);
    return jsonMessage(
      publicMessage(error, "删除豆包语音记录失败"),
      Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500,
    );
  } finally {
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((error) => {
        console.error("[Doubao Audio] release generation delete lease:", error);
      });
    }
  }
}
