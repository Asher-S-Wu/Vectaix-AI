import dbConnect from "@/lib/db";
import User from "@/models/User";
import { getAuthPayload } from './auth';

/**
 * 判断邮箱是否为管理员
 * 环境变量 ADMIN_EMAILS 用英文逗号分隔多个管理员邮箱
 */
export function isAdminEmail(email) {
  if (!email) return false;
  const raw = process.env.ADMIN_EMAILS || '';
  if (!raw) return false;
  const admins = raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  return admins.includes(email.trim().toLowerCase());
}

export function getUserAccessFlags(user) {
  if (user?.guestLinkId) return { isAdmin: false, isAdvancedUser: false };
  const isAdmin = isAdminEmail(user?.email);
  const isAdvancedUser = user?.isAdvancedUser === true;
  return {
    isAdmin,
    isAdvancedUser,
  };
}

export async function getCurrentUserWithAccess(request) {
  const payload = await getAuthPayload(request);
  if (payload?.kind !== "member") return null;

  await dbConnect();
  const user = await User.findOne({ _id: payload.userId, guestLinkId: { $exists: false } })
    .select("email isAdvancedUser")
    .lean();
  if (!user) return null;

  return {
    userId: user._id.toString(),
    email: user.email,
    ...getUserAccessFlags(user),
  };
}

/**
 * 验证当前请求用户是否为超级管理员
 * 返回 { payload, isAdmin } 或 null（未登录）
 */
export async function requireAdmin(request) {
  const payload = await getAuthPayload(request);
  if (payload?.kind !== "member") return null;
  if (!isAdminEmail(payload.email)) return null;
  return payload;
}
