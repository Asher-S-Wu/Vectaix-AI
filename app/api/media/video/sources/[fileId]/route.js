import {
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";
import {
  deleteOwnedTemporaryFile,
  findOwnedStoredFile,
  normalizeFileId,
} from "@/lib/server/storage/service";
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

export async function DELETE(request, context) {
  let mediaWriteLease = null;
  try {
    const auth = await requireUserRecord({ connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    const params = await context?.params;
    const fileId = normalizeFileId(params?.fileId);
    if (!fileId) return jsonMessage("素材不存在", 404);
    const file = await findOwnedStoredFile({ userId: user.userId, fileId });
    if (!file || !["media-image", "media-video"].includes(file.kind)) {
      return jsonMessage("素材不存在", 404);
    }
    if (file.ownerType !== "temporary") return jsonMessage("已用于任务的素材不能单独删除", 409);

    mediaWriteLease = await beginMediaWriteLease(user.userId);
    await assertMediaWriteLeaseActive(mediaWriteLease);
    const deleted = await deleteOwnedTemporaryFile({ userId: user.userId, fileId });
    if (!deleted) return jsonMessage("素材不存在", 404);
    return Response.json({ success: true, deleted: true });
  } catch (error) {
    console.error("[Media Video] delete source:", error);
    const status = Number.isInteger(error?.status)
      ? error.status
      : Number.isInteger(error?.statusCode)
        ? error.statusCode
        : 500;
    return jsonMessage(
      /[\u3400-\u9fff]/u.test(error?.message || "") ? error.message : "删除素材失败",
      status,
    );
  } finally {
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((error) => {
        console.error("[Media Video] release source delete lease:", error);
      });
    }
  }
}
