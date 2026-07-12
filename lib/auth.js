import crypto from "node:crypto";
import { cookies } from "next/headers";
import dbConnect from "@/lib/db";
import Session from "@/models/Session";
import User from "@/models/User";

const SESSION_COOKIE_NAME = "token";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function createSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

async function setSessionCookie(token) {
  (await cookies()).set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
}

export async function clearAuthCookie() {
  (await cookies()).delete(SESSION_COOKIE_NAME);
}

export async function startAuthSession(userId) {
  await dbConnect();
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  await Session.create({
    tokenHash: hashSessionToken(token),
    userId,
    expiresAt,
  });
  await setSessionCookie(token);
}

export async function getAuthPayload() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token || !SESSION_TOKEN_PATTERN.test(token)) return null;

  await dbConnect();
  const session = await Session.findOne({
    tokenHash: hashSessionToken(token),
    expiresAt: { $gt: new Date() },
  }).select("_id userId").lean();
  if (!session) return null;

  const user = await User.findById(session.userId).select("_id email").lean();
  if (!user) {
    await Session.deleteOne({ _id: session._id });
    return null;
  }

  return {
    userId: user._id.toString(),
    email: user.email,
    sessionId: session._id.toString(),
  };
}

export async function endCurrentAuthSession() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (token && SESSION_TOKEN_PATTERN.test(token)) {
    await dbConnect();
    await Session.deleteOne({ tokenHash: hashSessionToken(token) });
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
