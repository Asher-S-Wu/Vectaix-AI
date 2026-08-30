import mongoose from "mongoose";
import dbConnect from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import GuestLink from "@/models/GuestLink";
import { GuestAccessError, isGuestLinkId } from "@/lib/server/guest/links";

export async function requireGuestLinkAdmin(request) {
  const admin = await requireAdmin(request);
  if (!admin) throw new GuestAccessError("ADMIN_REQUIRED", "无权限", 403);
  await dbConnect();
  return admin;
}

export async function getManagedGuestLink(id) {
  if (!isGuestLinkId(id) || !mongoose.isValidObjectId(id)) {
    throw new GuestAccessError("GUEST_LINK_INVALID", "访问链接不存在", 404);
  }
  const link = await GuestLink.findById(id).select("+revision");
  if (!link) throw new GuestAccessError("GUEST_LINK_INVALID", "访问链接不存在", 404);
  return link;
}

export async function readGuestLinkBody(request) {
  try {
    return await request.json();
  } catch {
    throw new GuestAccessError("GUEST_LINK_INPUT_INVALID", "请求内容格式错误");
  }
}
