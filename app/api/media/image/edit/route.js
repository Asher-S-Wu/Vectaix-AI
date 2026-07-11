import { getAuthPayload } from "@/lib/auth";
import { editAndStoreImage } from "@/lib/media/server/inferera/images";
import {
  IMAGE_EDIT_ACCEPTED_MIME_TYPES,
  IMAGE_EDIT_MAX_BYTES,
  IMAGE_PROMPT_MAX_LENGTH,
  IMAGE_SIZE_OPTIONS,
} from "@/lib/media/shared/models";

const ALLOWED_SIZES = new Set(IMAGE_SIZE_OPTIONS.map((item) => item.id));
const ALLOWED_MIME_TYPES = new Set(IMAGE_EDIT_ACCEPTED_MIME_TYPES);

export async function POST(request) {
  try {
    const auth = await getAuthPayload();
    if (!auth) {
      return Response.json({ success: false, message: "未登录" }, { status: 401 });
    }

    const formData = await request.formData();
    const prompt = String(formData.get("prompt") || "").trim();
    const size = String(formData.get("size") || "1024x1024");
    const image = formData.get("image");

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

    if (!(image instanceof File)) {
      return Response.json({ success: false, message: "请上传需要编辑的图片" }, { status: 400 });
    }

    if (!ALLOWED_MIME_TYPES.has(image.type)) {
      return Response.json({ success: false, message: "仅支持 PNG、JPG、WEBP 图片" }, { status: 400 });
    }

    if (image.size <= 0 || image.size > IMAGE_EDIT_MAX_BYTES) {
      return Response.json({ success: false, message: "图片大小不能超过 25MB" }, { status: 400 });
    }

    const imageUrl = await editAndStoreImage({
      prompt,
      image,
      size,
      signal: request.signal,
    });

    return Response.json({ success: true, imageUrl });
  } catch (error) {
    console.error("[Media] edit image:", error);
    return Response.json(
      { success: false, message: error instanceof Error ? error.message : "图片编辑失败" },
      { status: 500 }
    );
  }
}
