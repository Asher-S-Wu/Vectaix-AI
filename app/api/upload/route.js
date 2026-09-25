import { getManagedModel } from '@/lib/server/models/service';
import { getModelConfig } from '@/lib/shared/models';
import { uploadTemporaryDocument } from "@/lib/server/workbench/documents";
import { getAuthPayload } from "@/lib/auth";
import dbConnect from "@/lib/db";
import { getClientIP, rateLimit } from "@/lib/rateLimit";
import {
  DOCUMENT_EXTENSIONS,
  getAttachmentCategory,
  getAttachmentInputType,
  getAttachmentLimits,
  getFileExtension,
  isSupportedUploadExtension,
} from "@/lib/shared/attachments";
import {
  isImageGenerationModel,
  isMediaGenerationModel,
} from "@/lib/shared/models";
import {
  getImageModelConfig,
  validateImageReferences,
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
  const user = await getAuthPayload(request);
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
    const imageConfig = kind === "chat" && isImageGenerationModel(model)
      ? getImageModelConfig(model)
      : null;
    const originalName = String(file.name || "").trim();
    const extension = getFileExtension(originalName);
    if (!extension || !isSupportedUploadExtension(extension)) {
      return jsonError("不支持该文件类型");
    }
    if (imageConfig) validateImageReferences(model, [file], { requireImages: true });
    if (DOCUMENT_EXTENSIONS.includes(extension)) {
      if (kind !== "chat" || isMediaGenerationModel(model)) return jsonError("当前用途不支持文档");
      await dbConnect();
      mediaWriteLease = await beginMediaWriteLease(user.userId);
      const stored = await uploadTemporaryDocument({ userId: user.userId, file, mediaWriteLease });
      cleanupExpiredTemporaryFiles().catch(error => console.error("[Storage] cleanup temporary files:", error));
      return Response.json(stored, { status: 201 });
    }
    if (
      QWEN_ONLY_IMAGE_EXTENSIONS.has(extension)
      && imageConfig?.service !== "qwen"
    ) {
      return jsonError("该图片格式仅支持千问图片模型");
    }
    const limits = getAttachmentLimits(getAttachmentCategory({ extension }));
    const maxBytes = imageConfig
      ? imageConfig.maxImageBytes
      : limits.maxBytes;
    if (file.size <= 0 || file.size > maxBytes) {
      const maxMb = Math.round(maxBytes / (1024 * 1024));
      return jsonError(`文件大小不能超过 ${maxMb}MB`);
    }
    const input = Buffer.from(await file.arrayBuffer());
    const inspected = inspectUploadedFile(input, extension);
    if (!inspected) return jsonError("文件内容与扩展名不匹配");
    const { mimeType, category } = inspected;
    if (imageConfig) {
      validateImageReferences(model, [{ name: originalName, type: mimeType, size: input.length }], { requireImages: true });
    }
    if (kind === "avatar" && category !== "image") {
      return jsonError("头像仅支持图片文件");
    }

    if (kind === "chat") {
      const modelConfig = isMediaGenerationModel(model) ? getModelConfig(model) : await getManagedModel(model);
      const support = { supportsImages: modelConfig.nativeInputs.includes("image"), supportsAudio: modelConfig.nativeInputs.includes("audio"), supportsVideo: modelConfig.nativeInputs.includes("video") };
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
    const errorStatus = error?.status ?? error?.statusCode;
    const status = Number.isInteger(errorStatus) && errorStatus >= 400 && errorStatus <= 599
      ? errorStatus
      : 500;
    const message = status < 500 || error?.publicMessage === true
      ? error.message
      : "文件上传失败";
    return jsonError(message, status);
  } finally {
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((error) => {
        console.error("[Upload] release media write lease:", error);
      });
    }
  }
}
