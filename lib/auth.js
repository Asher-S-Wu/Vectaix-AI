import crypto from "node:crypto";
import { cookies, headers } from "next/headers";
import dbConnect from "@/lib/db";
import Session from "@/models/Session";
import User from "@/models/User";
import GuestLink from "@/models/GuestLink";
import { GuestAccessError, findActiveGuestLink, isGuestLinkId } from "@/lib/server/guest/links";

const SESSION_COOKIE_NAME = "token";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function createSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

async function setSessionCookie(name, token) {
  (await cookies()).set(name, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
}

async function readGuestContext(request) {
  const requestHeaders = request ? request.headers : await headers();
  const headerPresent = requestHeaders.has("x-guest-link-id");
  const headerId = requestHeaders.get("x-guest-link-id");
  const queryIds = request ? new URL(request.url).searchParams.getAll("guestLinkId") : [];
  const selected = headerPresent || queryIds.length > 0;
  if (!selected) return { selected: false, valid: true, id: null };
  const queryId = queryIds[0];
  if (queryIds.length > 1 || (headerPresent && !isGuestLinkId(headerId))
    || (queryIds.length > 0 && !isGuestLinkId(queryId))
    || (headerPresent && queryIds.length > 0 && headerId !== queryId)) {
    return { selected: true, valid: false, id: null };
  }
  return { selected: true, valid: true, id: headerPresent ? headerId : queryId };
}

export async function hasGuestRequestContext(request) {
  return (await readGuestContext(request)).selected;
}

export async function assertGuestRequestContext(id, request) {
  const context = await readGuestContext(request);
  if (!isGuestLinkId(id) || !context.valid || (context.selected && context.id !== id)) {
    throw new GuestAccessError("GUEST_CONTEXT_INVALID", "访问空间信息不一致，请重新打开访问链接", 400);
  }
}

export async function clearAuthCookie() {
  (await cookies()).delete(SESSION_COOKIE_NAME);
}

function memberSessionBlockedError() {
  return Object.assign(new Error("账号不可用，无法创建登录会话"), {
    name: "AuthSessionBlockedError",
    code: "USER_UNAVAILABLE",
  });
}

export async function startAuthSession(userId) {
  await dbConnect();
  const filter = { _id: userId, guestLinkId: { $exists: false }, deletionInProgress: { $ne: true } };
  if (!await User.exists(filter)) throw memberSessionBlockedError();

  const token = createSessionToken();
  const session = await Session.create({
    tokenHash: hashSessionToken(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
  });
  if (!await User.exists(filter)) {
    await Session.deleteOne({ _id: session._id });
    throw memberSessionBlockedError();
  }
  await setSessionCookie(SESSION_COOKIE_NAME, token);
}

export async function startGuestAuthSession(link) {
  await dbConnect();
  const userFilter = { _id: link.userId, guestLinkId: link._id, deletionInProgress: { $ne: true } };
  const linkFilter = { _id: link._id, userId: link.userId, revision: link.revision, enabled: true, deletionInProgress: { $ne: true } };
  if (!await User.exists(userFilter) || !await GuestLink.exists(linkFilter)) {
    throw new GuestAccessError("GUEST_LINK_INVALID", "访问链接无效或已重置", 403);
  }
  const cookieName = `guest_${link._id.toString()}`;
  const previousToken = (await cookies()).get(cookieName)?.value;
  const token = createSessionToken();
  const session = await Session.create({
    tokenHash: hashSessionToken(token),
    userId: link.userId,
    guestLinkId: link._id,
    guestLinkRevision: link.revision,
    expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
  });
  if (!await User.exists(userFilter) || !await GuestLink.exists(linkFilter)) {
    await Session.deleteOne({ _id: session._id });
    throw new GuestAccessError("GUEST_LINK_INVALID", "访问链接无效或已重置", 403);
  }
  if (previousToken && SESSION_TOKEN_PATTERN.test(previousToken)) {
    await Session.deleteOne({ tokenHash: hashSessionToken(previousToken), guestLinkId: link._id });
  }
  await setSessionCookie(cookieName, token);
}

export async function getGuestSessionPayload(id, request) {
  await assertGuestRequestContext(id, request);
  await dbConnect();
  const link = await findActiveGuestLink(id);
  const token = (await cookies()).get(`guest_${id}`)?.value;
  if (!token || !SESSION_TOKEN_PATTERN.test(token)) {
    throw new GuestAccessError("GUEST_SESSION_REQUIRED", "请使用完整访问链接进入此空间", 401);
  }
  const session = await Session.findOne({
    tokenHash: hashSessionToken(token),
    guestLinkId: link._id,
    userId: link.userId,
    expiresAt: { $gt: new Date() },
  }).select("_id userId guestLinkRevision").lean();
  if (!session) {
    throw new GuestAccessError("GUEST_SESSION_EXPIRED", "访问已过期，请重新打开完整访问链接", 401);
  }
  if (session.guestLinkRevision !== link.revision) {
    await Session.deleteOne({ _id: session._id });
    throw new GuestAccessError("GUEST_LINK_INVALID", "访问链接无效或已重置", 401);
  }
  const user = await User.findOne({
    _id: session.userId,
    guestLinkId: link._id,
    deletionInProgress: { $ne: true },
  }).select("_id").lean();
  if (!user) {
    await Session.deleteOne({ _id: session._id });
    throw new GuestAccessError("GUEST_LINK_INVALID", "访问链接无效或已重置", 401);
  }
  return {
    userId: user._id.toString(),
    sessionId: session._id.toString(),
    kind: "guest",
    guestLinkId: id,
    allowedModelIds: link.allowedModelIds,
    name: link.name,
  };
}

export async function getAuthPayload(request) {
  const context = await readGuestContext(request);
  if (!context.valid) return null;
  if (context.selected) {
    try {
      return await getGuestSessionPayload(context.id, request);
    } catch (error) {
      if (error instanceof GuestAccessError) return null;
      throw error;
    }
  }
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token || !SESSION_TOKEN_PATTERN.test(token)) return null;

  await dbConnect();
  const session = await Session.findOne({
    tokenHash: hashSessionToken(token),
    guestLinkId: { $exists: false },
    expiresAt: { $gt: new Date() },
  }).select("_id userId").lean();
  if (!session) return null;

  const user = await User.findOne({
    _id: session.userId,
    guestLinkId: { $exists: false },
    deletionInProgress: { $ne: true },
  }).select("_id email").lean();
  if (!user) {
    await Session.deleteOne({ _id: session._id });
    return null;
  }
  return { userId: user._id.toString(), email: user.email, sessionId: session._id.toString(), kind: "member" };
}

export async function endCurrentAuthSession() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (token && SESSION_TOKEN_PATTERN.test(token)) {
    await dbConnect();
    await Session.deleteOne({ tokenHash: hashSessionToken(token), guestLinkId: { $exists: false } });
  }
  await clearAuthCookie();
}

export async function deleteAllAuthSessionsForUser(userId) {
  await dbConnect();
  const result = await Session.deleteMany({ userId });
  return result.deletedCount || 0;
}

export async function replaceAuthSessionsForUser(userId) {
  await deleteAllAuthSessionsForUser(userId);
  await startAuthSession(userId);
}
