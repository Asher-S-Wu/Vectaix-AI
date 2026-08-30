import GuestLink from "@/models/GuestLink";
import User from "@/models/User";
import Session from "@/models/Session";
import { getManagedGuestLink, readGuestLinkBody, requireGuestLinkAdmin } from "@/lib/server/guest/administration";
import { GuestAccessError, guestErrorResponse, serializeGuestLink, validateGuestLinkInput } from "@/lib/server/guest/links";
import { deleteUserAndData } from "@/lib/server/guest/deleteUser";
import { UserOperationLeaseError } from "@/lib/media/server/userOperationLeases";

export const dynamic = "force-dynamic";

export async function PATCH(request, context) {
  try {
    await requireGuestLinkAdmin(request);
    const { id } = await context.params;
    const current = await getManagedGuestLink(id);
    const data = validateGuestLinkInput(await readGuestLinkBody(request), { partial: true });
    const user = await User.exists({ _id: current.userId, guestLinkId: current._id, deletionInProgress: { $ne: true } });
    if (!user || current.deletionInProgress) {
      throw new GuestAccessError("GUEST_LINK_DELETING", "此访问空间正在删除，不能修改", 409);
    }
    const link = await GuestLink.findOneAndUpdate(
      { _id: current._id, deletionInProgress: { $ne: true } },
      { $set: data },
      { new: true, runValidators: true },
    );
    if (!link) throw new GuestAccessError("GUEST_LINK_DELETING", "此访问空间正在删除，不能修改", 409);
    if (data.enabled === false) await Session.deleteMany({ guestLinkId: link._id });
    return Response.json({ link: serializeGuestLink(link) });
  } catch (error) {
    return guestErrorResponse(error);
  }
}

export async function DELETE(request, context) {
  try {
    await requireGuestLinkAdmin(request);
    const { id } = await context.params;
    const current = await getManagedGuestLink(id);
    await GuestLink.updateOne({ _id: current._id }, { $set: { enabled: false, deletionInProgress: true } });
    await Session.deleteMany({ guestLinkId: current._id });
    const user = await User.findById(current.userId).select("guestLinkId").lean();
    if (user && user.guestLinkId?.toString() !== current._id.toString()) {
      throw new GuestAccessError("GUEST_USER_MISMATCH", "访问空间身份关联异常，已停止删除", 409);
    }
    if (user) await deleteUserAndData(current.userId);
    await GuestLink.deleteOne({ _id: current._id, enabled: false, deletionInProgress: true });
    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof UserOperationLeaseError) {
      return Response.json({ error: error.message, code: error.code, reconciliation: error.reconciliation }, { status: error.statusCode });
    }
    return guestErrorResponse(error);
  }
}
