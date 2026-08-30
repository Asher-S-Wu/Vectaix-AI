import {
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";
import AudioGeneration from "@/models/AudioGeneration";
import { AUDIO_MODEL } from "@/lib/media/shared/models";
import { deleteStoredFilesByOwner } from "@/lib/server/storage/service";
import {
  assertMediaWriteLeaseActive,
  beginMediaWriteLease,
  endMediaWriteLease,
} from "@/lib/media/server/userOperationLeases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonMessage(message, status = 400) {
  return Response.json({ success: false, message }, { status });
}

function publicMessage(error, fallback) {
  const message = error instanceof Error ? error.message : "";
  return /[\u3400-\u9fff]/u.test(message) ? message : fallback;
}

async function getGenerationId(context) {
  const params = await context?.params;
  return typeof params?.id === "string" ? params.id.trim() : "";
}

export async function DELETE(request, context) {
  let mediaWriteLease = null;
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    mediaWriteLease = await beginMediaWriteLease(user.userId);

    const generationId = await getGenerationId(context);
    const generation = await AudioGeneration.findOne({
      generationId,
      userId: user.userId,
      model: AUDIO_MODEL,
    });
    if (!generation) return jsonMessage("语音记录不存在", 404);

    await assertMediaWriteLeaseActive(mediaWriteLease);
    await deleteStoredFilesByOwner({
      userId: user.userId,
      ownerType: "audio-generation",
      ownerId: generation.generationId,
    });
    await AudioGeneration.deleteOne({
      _id: generation._id,
      userId: user.userId,
    });

    return Response.json({ success: true, deleted: true });
  } catch (error) {
    console.error("[Media Audio] delete generation:", error);
    return jsonMessage(
      publicMessage(error, "删除语音记录失败"),
      Number.isInteger(error?.status)
        ? error.status
        : Number.isInteger(error?.statusCode)
          ? error.statusCode
          : 500,
    );
  } finally {
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((leaseError) => {
        console.error("[Media Audio] release media write lease:", leaseError);
      });
    }
  }
}
