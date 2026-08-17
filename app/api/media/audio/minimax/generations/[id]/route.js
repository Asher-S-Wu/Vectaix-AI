import {
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";
import {
  assertMediaWriteLeaseActive,
  beginMediaWriteLease,
  endMediaWriteLease,
} from "@/lib/media/server/userOperationLeases";
import { deleteStoredFilesByOwner } from "@/lib/server/storage/service";
import MinimaxAudioGeneration from "@/models/MinimaxAudioGeneration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonMessage(message, status = 400) {
  return Response.json({ success: false, message }, { status });
}

async function readId(context) {
  const params = await context?.params;
  return typeof params?.id === "string" ? params.id.trim() : "";
}

export async function DELETE(request, context) {
  let mediaWriteLease = null;
  try {
    const auth = await requireUserRecord({ connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    mediaWriteLease = await beginMediaWriteLease(user.userId);
    const generationId = await readId(context);
    const generation = await MinimaxAudioGeneration.findOne({
      generationId,
      userId: user.userId,
    });
    if (!generation) return jsonMessage("MiniMax 语音记录不存在", 404);
    await assertMediaWriteLeaseActive(mediaWriteLease);
    await deleteStoredFilesByOwner({
      userId: user.userId,
      ownerType: "audio-generation",
      ownerId: generation.generationId,
    });
    await MinimaxAudioGeneration.deleteOne({ _id: generation._id, userId: user.userId });
    return Response.json({ success: true, deleted: true });
  } catch (error) {
    console.error("[MiniMax Audio] delete generation:", error);
    const message = error instanceof Error && /[\u3400-\u9fff]/u.test(error.message)
      ? error.message
      : "删除 MiniMax 语音记录失败";
    return jsonMessage(message, Number.isInteger(error?.status) ? error.status : 500);
  } finally {
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((error) => {
        console.error("[MiniMax Audio] release delete lease:", error);
      });
    }
  }
}

