import crypto from "node:crypto";
import { resolvePublicAppUrl } from "@/lib/modelRoutes";

export const VIDEO_SOURCE_ACCESS_TTL_MS = 60 * 60 * 1000;
export const VIDEO_SOURCE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function createVideoSourceAccess() {
  const token = crypto.randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashVideoSourceToken(token),
    expiresAt: new Date(Date.now() + VIDEO_SOURCE_ACCESS_TTL_MS),
  };
}

export function hashVideoSourceToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

export function videoSourceTokensMatch(token, expectedHash) {
  const actual = crypto.createHash("sha256").update(String(token || "")).digest();
  const expected = Buffer.from(String(expectedHash || ""), "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}

export function buildVideoSourceUrl({ taskId, fileId, token }) {
  const appUrl = resolvePublicAppUrl();
  const path = [taskId, fileId].map((value) => encodeURIComponent(String(value))).join("/");
  return `${appUrl}/api/media/video/source/${path}?token=${encodeURIComponent(token)}`;
}
