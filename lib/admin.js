import dbConnect from "@/lib/db";
import User from "@/models/User";

async function getAuthPayloadForRequest(request) {
  const { getAuthPayload } = await import('./auth');
  return getAuthPayload(request);
}

export function getAdminEmails() {
  return [...new Set(
    String(process.env.ADMIN_EMAILS || '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  )];
}

/**
 * 判断邮箱是否为管理员
 * 环境变量 ADMIN_EMAILS 用英文逗号分隔多个管理员邮箱
 */
export function isAdminEmail(email) {
  if (!email) return false;
  return getAdminEmails().includes(email.trim().toLowerCase());
}

export async function verifyConfiguredAdminAccounts() {
  const emails = getAdminEmails();
  if (emails.length === 0) return { configured: 0 };
  await dbConnect();
  const accounts = await User.collection.find({
    email: { $in: emails, $type: 'string', $regex: /\S/ },
    password: { $type: 'string', $regex: /\S/ },
    guestLinkId: { $exists: false },
    deletionInProgress: { $ne: true },
  }, { projection: { email: 1 } }).toArray();
  const counts = new Map();
  for (const account of accounts) {
    const email = String(account.email || '').trim().toLowerCase();
    counts.set(email, (counts.get(email) || 0) + 1);
  }
  const missing = emails.filter((email) => !counts.has(email));
  const duplicated = emails.filter((email) => (counts.get(email) || 0) > 1);
  if (missing.length > 0 || duplicated.length > 0) {
    throw Object.assign(new Error(
      duplicated.length > 0
        ? `有 ${duplicated.length} 个超级管理员邮箱对应多个账号`
        : `有 ${missing.length} 个超级管理员邮箱尚未注册`,
    ), {
      name: 'AdminConfigurationError',
      code: duplicated.length > 0 ? 'ADMIN_ACCOUNT_DUPLICATED' : 'ADMIN_ACCOUNT_MISSING',
    });
  }
  return { configured: accounts.length };
}

export function getUserAccessFlags(user) {
  const isAdmin = isAdminEmail(user?.email);
  const isAdvancedUser = user?.isAdvancedUser === true;
  return {
    isAdmin,
    isAdvancedUser,
  };
}

export async function getCurrentUserWithAccess(request) {
  const payload = await getAuthPayloadForRequest(request);
  if (!payload) return null;

  await dbConnect();
  const user = await User.findOne({ _id: payload.userId })
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
  const payload = await getAuthPayloadForRequest(request);
  if (!payload) return null;
  if (!isAdminEmail(payload.email)) return null;
  return payload;
}
