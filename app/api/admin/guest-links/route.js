import mongoose from "mongoose";
import GuestLink from "@/models/GuestLink";
import User from "@/models/User";
import { readGuestLinkBody, requireGuestLinkAdmin } from "@/lib/server/guest/administration";
import {
  assertGuestUserIndexesReady,
  buildGuestLinkUrl,
  guestErrorResponse,
  requireGuestLinkSecret,
  serializeGuestLink,
  validateGuestLinkInput,
} from "@/lib/server/guest/links";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    await requireGuestLinkAdmin(request);
    const links = await GuestLink.find().sort({ createdAt: -1 }).lean();
    return Response.json({ links: links.map(serializeGuestLink) });
  } catch (error) {
    return guestErrorResponse(error);
  }
}

export async function POST(request) {
  try {
    const admin = await requireGuestLinkAdmin(request);
    const data = validateGuestLinkInput(await readGuestLinkBody(request));
    requireGuestLinkSecret();
    await assertGuestUserIndexesReady();
    const id = new mongoose.Types.ObjectId();
    const user = await User.create({ guestLinkId: id });
    let link;
    try {
      link = await GuestLink.create({ ...data, _id: id, userId: user._id, createdBy: admin.userId });
    } catch (error) {
      await User.deleteOne({ _id: user._id, guestLinkId: id });
      throw error;
    }
    return Response.json({ link: serializeGuestLink(link), url: buildGuestLinkUrl(link) }, { status: 201 });
  } catch (error) {
    return guestErrorResponse(error);
  }
}
