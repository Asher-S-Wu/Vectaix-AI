import dbConnect from "@/lib/db";
import { assertGuestRequestContext, getGuestSessionPayload, startGuestAuthSession } from "@/lib/auth";
import { readGuestLinkBody } from "@/lib/server/guest/administration";
import { GuestAccessError, findActiveGuestLink, guestErrorResponse, verifyGuestLinkKey } from "@/lib/server/guest/links";
import { getClientIP, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

function sessionResponse(user) {
  return Response.json({
    user: {
      id: user.userId,
      kind: "guest",
      guestLinkId: user.guestLinkId,
      name: user.name,
      allowedModelIds: user.allowedModelIds,
      isAdmin: false,
      isAdvancedUser: false,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request, context) {
  try {
    const { id } = await context.params;
    return sessionResponse(await getGuestSessionPayload(id, request));
  } catch (error) {
    return guestErrorResponse(error);
  }
}

export async function POST(request, context) {
  try {
    const { id } = await context.params;
    await assertGuestRequestContext(id, request);
    const limit = rateLimit(`guest-entry:${getClientIP(request)}`, { limit: 30, windowMs: 60_000 });
    if (!limit.success) throw new GuestAccessError("GUEST_ENTRY_RATE_LIMIT", "访问过于频繁，请稍后再试", 429);
    const body = await readGuestLinkBody(request);
    await dbConnect();
    const link = await findActiveGuestLink(id);
    if (!verifyGuestLinkKey(link, body?.key)) {
      throw new GuestAccessError("GUEST_LINK_INVALID", "访问链接无效或已重置", 403);
    }
    await startGuestAuthSession(link);
    return sessionResponse({ userId: link.userId.toString(), guestLinkId: id, name: link.name, allowedModelIds: link.allowedModelIds });
  } catch (error) {
    return guestErrorResponse(error);
  }
}
