import { getClientIP, rateLimit } from "@/lib/rateLimit";
import {
  parseJsonRequest,
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";
import {
  VIDEO_ENHANCEMENT_MODEL,
  createVideoEnhancementUploadExpiry,
  normalizeVideoEnhancementUploadInput,
} from "@/lib/media/shared/videoEnhancement";
import {
  MediaKitError,
  requestMediaKitUploadTicket,
} from "@/lib/media/server/mediaKit/client";
import {
  assertMediaWriteLeaseActive,
  beginMediaWriteLease,
  endMediaWriteLease,
} from "@/lib/media/server/userOperationLeases";
import MediaKitUploadTicket from "@/models/MediaKitUploadTicket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_JSON_BYTES = 16 * 1024;
const UPLOAD_TICKET_TIMEOUT_MS = 30 * 1000;
const USER_RATE_LIMIT = Object.freeze({ limit: 10, windowMs: 60 * 1000 });
const IP_RATE_LIMIT = Object.freeze({ limit: 30, windowMs: 60 * 1000 });

function jsonMessage(message, status = 400) {
  return Response.json({ success: false, message }, { status });
}

function safeErrorDetails(error) {
  const errorType = /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error?.name || "")
    ? error.name
    : "Error";
  const code = /^[A-Z][A-Z0-9_]{0,63}$/.test(error?.code || "")
    ? error.code
    : "INTERNAL_ERROR";
  return { errorType, code };
}

function getErrorStatus(error, fallback = 500) {
  const status = Number(error?.status ?? error?.statusCode);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : fallback;
}

function getPublicErrorMessage(error, fallback) {
  if (error instanceof MediaKitError || error?.name === "UserOperationLeaseError") {
    return error.message;
  }
  return fallback;
}

function isRateLimited(request, userId) {
  const ip = getClientIP(request);
  const userLimit = rateLimit(`media-video-enhancement-upload:user:${userId}`, USER_RATE_LIMIT);
  const ipLimit = rateLimit(`media-video-enhancement-upload:ip:${ip}`, IP_RATE_LIMIT);
  return !userLimit.success || !ipLimit.success;
}

export async function POST(request) {
  let mediaWriteLease = null;
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    if (isRateLimited(request, user.userId)) {
      return jsonMessage("上传凭证申请过于频繁，请稍后再试", 429);
    }

    const parsed = await parseJsonRequest(request, "请求内容格式错误", MAX_JSON_BYTES);
    if (!parsed.ok) {
      return jsonMessage(
        parsed.response.status === 413 ? "请求内容过大" : "请求内容格式错误",
        parsed.response.status,
      );
    }
    let input;
    try {
      input = normalizeVideoEnhancementUploadInput(parsed.body);
    } catch {
      return jsonMessage("视频上传参数不符合要求", 400);
    }

    mediaWriteLease = await beginMediaWriteLease(user.userId);
    const issuedAt = new Date();
    const expiresAt = createVideoEnhancementUploadExpiry(issuedAt);
    const upstream = await requestMediaKitUploadTicket({
      signal: AbortSignal.any([
        request.signal,
        AbortSignal.timeout(UPLOAD_TICKET_TIMEOUT_MS),
      ]),
    });
    await assertMediaWriteLeaseActive(mediaWriteLease);
    const ticket = await MediaKitUploadTicket.create({
      userId: user.userId,
      providerFileId: upstream.providerFileId,
      status: "issued",
      safeOriginalName: input.safeOriginalName,
      size: input.size,
      mimeType: input.mimeType,
      extension: input.extension,
      expiresAt,
    });

    return Response.json({
      success: true,
      upload: {
        id: String(ticket._id),
        method: upstream.method,
        uploadUrl: upstream.uploadUrl,
        uploadHeaders: upstream.uploadHeaders,
        expiresAt,
      },
    }, { status: 201 });
  } catch (error) {
    console.error("[AI MediaKit] create upload ticket failed", safeErrorDetails(error));
    return jsonMessage(
      getPublicErrorMessage(error, "申请视频上传凭证失败"),
      getErrorStatus(error),
    );
  } finally {
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((error) => {
        console.error("[AI MediaKit] release upload lease failed", safeErrorDetails(error));
      });
    }
  }
}
