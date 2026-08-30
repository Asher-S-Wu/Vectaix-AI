import {
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";
import { normalizeFileId } from "@/lib/server/storage/service";
import { deleteOwnedTemporaryAudioSource } from "@/lib/media/server/audioSourceUploads";
import {
  beginMediaWriteLease,
  endMediaWriteLease,
} from "@/lib/media/server/userOperationLeases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonMessage(message, status = 400) {
  return Response.json({ success: false, message }, { status });
}

export async function DELETE(request, context) {
  let mediaWriteLease = null;
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    const params = await context?.params;
    const fileId = normalizeFileId(params?.id);
    if (!fileId) return jsonMessage("临时音频不存在", 404);

    mediaWriteLease = await beginMediaWriteLease(user.userId);
    const deleted = await deleteOwnedTemporaryAudioSource({
      userId: user.userId,
      fileId,
    });
    if (!deleted) return jsonMessage("临时音频不存在或正在使用", 404);
    return Response.json({ success: true, deleted: true });
  } catch (error) {
    console.error("[Media Audio] delete upload:", error);
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return jsonMessage(
      /[\u3400-\u9fff]/u.test(error?.message || "") ? error.message : "清理临时音频失败",
      status,
    );
  } finally {
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((error) => {
        console.error("[Media Audio] release upload delete lease:", error);
      });
    }
  }
}
