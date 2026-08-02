import { getAuthPayload } from "@/lib/auth";
import dbConnect from "@/lib/db";
import { getClientIP, rateLimit } from "@/lib/rateLimit";
import {
  getAttachmentInputType,
  getAttachmentLimits,
  getFileExtension,
  isSupportedUploadExtension,
} from "@/lib/shared/attachments";
import {
  getModelAttachmentSupport,
  isImageGenerationModel,
} from "@/lib/shared/models";
import {
  IMAGE_EDIT_ACCEPTED_EXTENSIONS,
  IMAGE_EDIT_MAX_BYTES,
} from "@/lib/media/shared/models";
import { inspectUploadedFile } from "@/lib/server/storage/fileInspection";
import {
  cleanupExpiredTemporaryFiles,
  createStoredFile,
  serializeStoredFile,
} from "@/lib/server/storage/service";
import {
  assertMediaWriteLeaseActive,
  beginMediaWriteLease,
  endMediaWriteLease,
} from "@/lib/media/server/userOperationLeases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPLOAD_RATE_LIMIT = { limit: 30, windowMs: 10 * 60 * 1000 };
const QWEN_ONLY_IMAGE_EXTENSIONS = new Set(["bmp", "tif", "tiff"]);

function jsonError(error, status = 400) {
  return Response.json({ error }, { status });
}

export async function POST(request) {
  const user = await getAuthPayload();
  if (!user?.userId) return jsonError("未登录", 401);
  let mediaWriteLease = null;

  const clientIP = getClientIP(request);
  const limited = rateLimit(`upload:${user.userId}:${clientIP}`, UPLOAD_RATE_LIMIT);
  if (!limited.success) {
    return jsonError("上传过于频繁，请稍后再试", 429);
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const kind = String(formData.get("kind") || "chat").trim();
    const model = String(formData.get("model") || "").trim();
    if (!(file instanceof File)) return jsonError("缺少上传文件");
    if (kind !== "chat" && kind !== "avatar") return jsonError("上传用途不合法");

    const originalName = String(file.name || "").trim();
    const extension = getFileExtension(originalName);
    if (!extension || !isSupportedUploadExtension(extension)) {
      return jsonError("不支持该文件类型");
    }
    if (
      QWEN_ONLY_IMAGE_EXTENSIONS.has(extension)
      && (kind !== "chat" || !isImageGenerationModel(model))
    ) {
      return jsonError("该图片格式仅支持千问图片模型");
    }
    const isImageExtension = IMAGE_EDIT_ACCEPTED_EXTENSIONS.includes(extension);
    const limits = getAttachmentLimits(
      isImageExtension
        ? "image"
        : ["mp3", "wav", "m4a", "aac", "ogg", "weba"].includes(extension)
          ? "audio"
          : "video"
    );
    const maxBytes = kind === "chat" && isImageGenerationModel(model) && isImageExtension
      ? IMAGE_EDIT_MAX_BYTES
      : limits.maxBytes;
    if (file.size <= 0 || file.size > maxBytes) {
      const maxMb = Math.round(maxBytes / (1024 * 1024));
      return jsonError(`文件大小不能超过 ${maxMb}MB`);
    }
    const input = Buffer.from(await file.arrayBuffer());
    const inspected = inspectUploadedFile(input, extension);
    if (!inspected) return jsonError("文件内容与扩展名不匹配");
    const { mimeType, category } = inspected;
    if (kind === "avatar" && category !== "image") {
      return jsonError("头像仅支持图片文件");
    }

    if (kind === "chat") {
      const support = getModelAttachmentSupport(model);
      const inputType = getAttachmentInputType(category);
      const supported = (
        (inputType === "image" && support.supportsImages)
        || (inputType === "video" && support.supportsVideo)
        || (inputType === "audio" && support.supportsAudio)
      );
      if (!supported) return jsonError("当前模型不支持这类文件");
    }

    await dbConnect();
    mediaWriteLease = await beginMediaWriteLease(user.userId);
    await assertMediaWriteLeaseActive(mediaWriteLease);
    const stored = await createStoredFile({
      userId: user.userId,
      input,
      originalName,
      mimeType,
      extension,
      category,
      kind,
      mediaWriteLease,
    });
    cleanupExpiredTemporaryFiles().catch((error) => {
      console.error("[Storage] cleanup temporary files:", error);
    });
    return Response.json(serializeStoredFile(stored), { status: 201 });
  } catch (error) {
    console.error("[Upload] save file:", error);
    const status = Number.isInteger(error?.status)
      ? error.status
      : Number.isInteger(error?.statusCode)
        ? error.statusCode
        : 500;
    return jsonError(error instanceof Error ? error.message : "文件上传失败", status);
  } finally {
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((error) => {
        console.error("[Upload] release media write lease:", error);
      });
    }
  }
}
