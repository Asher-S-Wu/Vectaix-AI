import { modelAccessResponse } from "@/lib/server/guest/access";
import { getClientIP, rateLimit } from "@/lib/rateLimit";
import {
  assertRequestSize,
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";
import {
  VIDEO_MODEL,
  VIDEO_IMAGE_ACCEPTED_MIME_TYPES,
  VIDEO_IMAGE_MAX_BYTES,
  VIDEO_SOURCE_VIDEO_ACCEPTED_MIME_TYPES,
  VIDEO_SOURCE_VIDEO_MAX_BYTES,
} from "@/lib/media/shared/models";
import { getFileExtension } from "@/lib/shared/attachments";
import { saveVideoSourceStream } from "@/lib/media/storage";
import {
  cleanupExpiredTemporaryFiles,
  serializeStoredFile,
} from "@/lib/server/storage/service";
import {
  beginMediaWriteLease,
  endMediaWriteLease,
} from "@/lib/media/server/userOperationLeases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCE_UPLOAD_RATE_LIMIT = Object.freeze({ limit: 60, windowMs: 10 * 60 * 1000 });
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov"]);
const MIME_BY_EXTENSION = Object.freeze({
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  mp4: "video/mp4",
  mov: "video/quicktime",
});

function jsonMessage(message, status = 400) {
  return Response.json({ success: false, message }, { status });
}

export async function POST(request) {
  let mediaWriteLease = null;
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    const accessError = modelAccessResponse(user, VIDEO_MODEL);
    if (accessError) return accessError;
    const limited = rateLimit(
      `media-video-source:${user.userId}:${getClientIP(request)}`,
      SOURCE_UPLOAD_RATE_LIMIT,
    );
    if (!limited.success) return jsonMessage("上传过于频繁，请稍后再试", 429);

    const sizeError = assertRequestSize(
      request,
      VIDEO_SOURCE_VIDEO_MAX_BYTES,
      "视频素材不能超过 100MB",
    );
    if (sizeError) return sizeError;

    const encodedName = String(request.headers.get("x-file-name") || "").trim();
    let decodedName = "";
    try {
      decodedName = decodeURIComponent(encodedName).trim();
    } catch {
      return jsonMessage("素材文件名格式错误");
    }
    if (!decodedName || !request.body) return jsonMessage("请选择要上传的素材文件");
    const extension = getFileExtension(decodedName);
    const isImage = IMAGE_EXTENSIONS.has(extension);
    const isVideo = VIDEO_EXTENSIONS.has(extension);
    if (!isImage && !isVideo) return jsonMessage("仅支持 JPG、PNG、WEBP、MP4 或 MOV 文件");

    const extensionSuffix = `.${extension}`;
    const originalName = decodedName.length <= 200
      ? decodedName
      : `${decodedName.slice(0, 200 - extensionSuffix.length)}${extensionSuffix}`;

    const maxBytes = isImage ? VIDEO_IMAGE_MAX_BYTES : VIDEO_SOURCE_VIDEO_MAX_BYTES;
    const mimeType = MIME_BY_EXTENSION[extension];
    const acceptedMimeTypes = isImage
      ? VIDEO_IMAGE_ACCEPTED_MIME_TYPES
      : VIDEO_SOURCE_VIDEO_ACCEPTED_MIME_TYPES;
    if (!acceptedMimeTypes.includes(mimeType)) return jsonMessage("素材文件类型不受支持");

    mediaWriteLease = await beginMediaWriteLease(user.userId);
    const stored = await saveVideoSourceStream({
      userId: user.userId,
      input: request.body,
      mimeType,
      originalName,
      extension,
      category: isImage ? "image" : "video",
      maxBytes,
      signal: request.signal,
      mediaWriteLease,
    });
    cleanupExpiredTemporaryFiles().catch((error) => {
      console.error("[Media Video] cleanup temporary sources:", error);
    });
    return Response.json(
      { success: true, source: serializeStoredFile(stored) },
      { status: 201 },
    );
  } catch (error) {
    console.error("[Media Video] upload source:", error);
    const status = Number.isInteger(error?.status)
      ? error.status
      : Number.isInteger(error?.statusCode)
        ? error.statusCode
        : 500;
    return jsonMessage(
      /[\u3400-\u9fff]/u.test(error?.message || "") ? error.message : "上传素材失败",
      status,
    );
  } finally {
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((error) => {
        console.error("[Media Video] release source write lease:", error);
      });
    }
  }
}
