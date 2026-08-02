import dbConnect from "@/lib/db";
import User from "@/models/User";
import { getAuthPayload } from "@/lib/auth";

function buildJsonError(message, status = 400, init = {}) {
  return Response.json(
    { error: message },
    {
      status,
      ...init,
    },
  );
}

export function assertRequestSize(req, maxBytes, errorMessage = "Request too large") {
  const contentLength = req.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    return buildJsonError(errorMessage, 413);
  }
  return null;
}

async function readRequestBytes(req, maxBytes) {
  const reader = req.body?.getReader?.();
  if (!reader) {
    const bytes = new Uint8Array(await req.arrayBuffer());
    return bytes.byteLength > maxBytes ? null : bytes;
  }

  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      try { await reader.cancel(); } catch { /* ignore */ }
      return null;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function parseJsonRequest(req, errorMessage = "Invalid JSON", maxBytes = null) {
  try {
    if (Number.isFinite(maxBytes) && maxBytes > 0) {
      const bytes = await readRequestBytes(req, maxBytes);
      if (!bytes) {
        return {
          ok: false,
          body: null,
          response: buildJsonError("Request too large", 413),
        };
      }
      const text = new TextDecoder().decode(bytes);
      return { ok: true, body: JSON.parse(text) };
    }
    return { ok: true, body: await req.json() };
  } catch {
    return {
      ok: false,
      body: null,
      response: buildJsonError(errorMessage, 400),
    };
  }
}

export async function requireUserRecord({
  connectDb = true,
  select = "_id email isAdvancedUser",
} = {}) {
  if (connectDb) {
    await dbConnect();
  }

  const payload = await getAuthPayload();
  if (!payload?.userId) {
    return null;
  }

  const user = select
    ? await User.findOne({
        _id: payload.userId,
        deletionInProgress: { $ne: true },
      }).select(select).lean()
    : null;
  if (select && !user) {
    return null;
  }

  return {
    payload,
    user,
  };
}

export function unauthorizedResponse(message = "Unauthorized") {
  return buildJsonError(message, 401);
}

export function forbiddenResponse(message = "无权限") {
  return buildJsonError(message, 403);
}

export function invalidJsonResponse(message = "请求体格式错误") {
  return buildJsonError(message, 400);
}
