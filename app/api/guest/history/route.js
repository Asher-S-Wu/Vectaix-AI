import { getAuthPayload } from "@/lib/auth";
import { GuestAccessError, guestErrorResponse } from "@/lib/server/guest/links";
import { getGuestHistory } from "@/lib/server/guest/history";
import StoredFile from "@/models/StoredFile";
import { normalizeFileId } from "@/lib/shared/fileIds";
import { deleteStoredFileDocument } from "@/lib/server/storage/service";
import { assertMediaWriteLeaseActive, beginMediaWriteLease, endMediaWriteLease } from "@/lib/media/server/userOperationLeases";

export const dynamic = "force-dynamic";

async function requireGuest(request) {
  const payload = await getAuthPayload(request);
  if (payload?.kind !== "guest") {
    throw new GuestAccessError("GUEST_SESSION_REQUIRED", "请通过有效访问链接进入游客空间", 401);
  }
  return payload;
}

export async function GET(request) {
  try {
    const user = await requireGuest(request);
    const query = new URL(request.url).searchParams;
    const category = query.get("category");
    const page = query.has("page") ? Number(query.get("page")) : 1;
    return Response.json(await getGuestHistory(user.userId, category, page), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return guestErrorResponse(error);
  }
}

export async function DELETE(request) {
  let lease = null;
  try {
    const user = await requireGuest(request);
    const query = new URL(request.url).searchParams;
    const fileId = normalizeFileId(query.get("id"));
    if (query.get("category") !== "image" || !fileId) {
      throw new GuestAccessError("GUEST_HISTORY_ITEM_INVALID", "图片记录无效");
    }
    lease = await beginMediaWriteLease(user.userId);
    const file = await StoredFile.findOne({
      userId: user.userId,
      fileId,
      category: "image",
      kind: "media-image",
      ownerType: "image-result",
    });
    if (!file) throw new GuestAccessError("GUEST_HISTORY_ITEM_MISSING", "图片记录不存在", 404);
    await assertMediaWriteLeaseActive(lease);
    await deleteStoredFileDocument(file);
    return Response.json({ success: true });
  } catch (error) {
    return guestErrorResponse(error);
  } finally {
    if (lease) await endMediaWriteLease(lease);
  }
}
