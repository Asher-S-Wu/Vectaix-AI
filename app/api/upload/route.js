import { getAuthPayload } from "@/lib/auth";
import dbConnect from "@/lib/db";
import { getClientIP, rateLimit } from "@/lib/rateLimit";
import {
  getAttachmentInputType,
  getAttachmentLimits,
  getFileExtension,
  isSupportedUploadExtension,
} from "@/lib/shared/attachments";
import { getModelAttachmentSupport } from "@/lib/shared/models";
import { inspectUploadedFile } from "@/lib/server/storage/fileInspection";
import {
  cleanupExpiredTemporaryFiles,
  createStoredFile,
  serializeStoredFile,
} from "@/lib/server/storage/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPLOAD_RATE_LIMIT = { limit: 30, windowMs: 10 * 60 * 1000 };

function jsonError(error, status = 400) {
  return Response.json({ error }, { status });
}

export async function POST(request) {
  const user = await getAuthPayload();
  if (!user?.userId) return jsonError("未登录", 401);

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
    const limits = getAttachmentLimits(
      ["jpg", "jpeg", "png", "gif", "webp"].includes(extension)
        ? "image"
        : ["mp3", "wav", "m4a", "aac", "ogg", "weba"].includes(extension)
          ? "audio"
          : "video"
    );
    if (file.size <= 0 || file.size > limits.maxBytes) {
      return jsonError("文件大小不能超过 20MB");
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
    const stored = await createStoredFile({
      userId: user.userId,
      input,
      originalName,
      mimeType,
      extension,
      category,
      kind,
    });
    cleanupExpiredTemporaryFiles().catch((error) => {
      console.error("[Storage] cleanup temporary files:", error);
    });
    return Response.json(serializeStoredFile(stored), { status: 201 });
  } catch (error) {
    console.error("[Upload] save file:", error);
    return jsonError(error instanceof Error ? error.message : "文件上传失败", 500);
  }
}
