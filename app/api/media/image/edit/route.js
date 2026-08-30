import { modelAccessResponse } from "@/lib/server/guest/access";
import { getAuthPayload } from "@/lib/auth";
import dbConnect from "@/lib/db";
import { editAndStoreImage } from "@/lib/media/server/qwenImage";
import {
  IMAGE_MODEL,
  IMAGE_EDIT_ACCEPTED_MIME_TYPES,
  IMAGE_EDIT_ACCEPTED_EXTENSIONS,
  IMAGE_EDIT_MAX_BYTES,
  IMAGE_EDIT_MAX_COUNT,
  IMAGE_PROMPT_MAX_LENGTH,
  IMAGE_SIZE_OPTIONS,
} from "@/lib/media/shared/models";
import { getFileExtension } from "@/lib/shared/attachments";
import { inspectUploadedFile } from "@/lib/server/storage/fileInspection";
import {
  beginMediaWriteLease,
  endMediaWriteLease,
} from "@/lib/media/server/userOperationLeases";

const ALLOWED_SIZES = new Set(IMAGE_SIZE_OPTIONS.map((item) => item.id));
const ALLOWED_MIME_TYPES = new Set(IMAGE_EDIT_ACCEPTED_MIME_TYPES);

export async function POST(request) {
  let mediaWriteLease = null;
  try {
    const auth = await getAuthPayload(request);
    if (!auth) {
      return Response.json({ success: false, message: "未登录" }, { status: 401 });
    }
    const accessError = modelAccessResponse(auth, IMAGE_MODEL);
    if (accessError) return accessError;
    await dbConnect();

    const formData = await request.formData();
    const prompt = String(formData.get("prompt") || "").trim();
    const size = String(formData.get("size") || "auto");
    const images = formData.getAll("images");

    if (!prompt) {
      return Response.json({ success: false, message: "请输入图片描述" }, { status: 400 });
    }

    if (prompt.length > IMAGE_PROMPT_MAX_LENGTH) {
      return Response.json(
        { success: false, message: `描述最多支持 ${IMAGE_PROMPT_MAX_LENGTH} 个字符` },
        { status: 400 }
      );
    }

    if (!ALLOWED_SIZES.has(size)) {
      return Response.json({ success: false, message: "不支持的图片尺寸" }, { status: 400 });
    }

    if (images.length === 0 || images.length > IMAGE_EDIT_MAX_COUNT) {
      return Response.json(
        { success: false, message: `请上传 1 至 ${IMAGE_EDIT_MAX_COUNT} 张参考图片` },
        { status: 400 }
      );
    }

    const normalizedImages = [];
    for (const image of images) {
      const extension = image instanceof File ? getFileExtension(image.name) : "";
      if (!(image instanceof File) || !IMAGE_EDIT_ACCEPTED_EXTENSIONS.includes(extension)) {
        return Response.json(
          { success: false, message: "仅支持 JPG、PNG、BMP、TIFF、WEBP、GIF 图片" },
          { status: 400 }
        );
      }
      if (image.size <= 0 || image.size > IMAGE_EDIT_MAX_BYTES) {
        return Response.json(
          { success: false, message: "每张参考图片不能超过 10MB" },
          { status: 400 }
        );
      }
      const input = Buffer.from(await image.arrayBuffer());
      const inspected = inspectUploadedFile(input, extension);
      if (!inspected || !ALLOWED_MIME_TYPES.has(inspected.mimeType)) {
        return Response.json(
          { success: false, message: "图片内容与文件格式不一致" },
          { status: 400 }
        );
      }
      normalizedImages.push(new File([input], image.name, { type: inspected.mimeType }));
    }

    mediaWriteLease = await beginMediaWriteLease(auth.userId);
    const imageUrl = await editAndStoreImage({
      userId: auth.userId,
      prompt,
      images: normalizedImages,
      size,
      signal: request.signal,
      mediaWriteLease,
    });

    return Response.json({ success: true, imageUrl });
  } catch (error) {
    console.error("[Media] edit image:", error);
    return Response.json(
      { success: false, message: error instanceof Error ? error.message : "图片编辑失败" },
      {
        status: Number.isInteger(error?.status)
          ? error.status
          : Number.isInteger(error?.statusCode)
            ? error.statusCode
            : 500,
      }
    );
  } finally {
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((error) => {
        console.error("[Media] release image edit write lease:", error);
      });
    }
  }
}
