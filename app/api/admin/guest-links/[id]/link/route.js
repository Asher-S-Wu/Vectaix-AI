import crypto from "node:crypto";
import GuestLink from "@/models/GuestLink";
import Session from "@/models/Session";
import { getManagedGuestLink, requireGuestLinkAdmin } from "@/lib/server/guest/administration";
import { GuestAccessError, buildGuestLinkUrl, guestErrorResponse, requireGuestLinkSecret, serializeGuestLink } from "@/lib/server/guest/links";

export const dynamic = "force-dynamic";

export async function GET(request, context) {
  try {
    await requireGuestLinkAdmin(request);
    const { id } = await context.params;
    const link = await getManagedGuestLink(id);
    if (link.deletionInProgress) throw new GuestAccessError("GUEST_LINK_DELETING", "此访问空间正在删除", 409);
    return Response.json({ url: buildGuestLinkUrl(link) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return guestErrorResponse(error);
  }
}

export async function POST(request, context) {
  try {
    await requireGuestLinkAdmin(request);
    requireGuestLinkSecret();
    const { id } = await context.params;
    const current = await getManagedGuestLink(id);
    const link = await GuestLink.findOneAndUpdate(
      { _id: current._id, deletionInProgress: { $ne: true } },
      { $set: { revision: crypto.randomBytes(32).toString("base64url") } },
      { new: true, runValidators: true },
    ).select("+revision");
    if (!link) throw new GuestAccessError("GUEST_LINK_DELETING", "此访问空间正在删除", 409);
    await Session.deleteMany({ guestLinkId: link._id, guestLinkRevision: current.revision });
    return Response.json({ url: buildGuestLinkUrl(link), link: serializeGuestLink(link) });
  } catch (error) {
    return guestErrorResponse(error);
  }
}
