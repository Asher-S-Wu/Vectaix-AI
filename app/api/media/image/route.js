import { getAuthPayload } from "@/lib/auth";
import { generateAndStoreImage } from "@/lib/media/server/zenmux/images";
import { IMAGE_PROMPT_MAX_LENGTH, IMAGE_SIZE_OPTIONS } from "@/lib/media/shared/models";

const ALLOWED_SIZES = new Set(IMAGE_SIZE_OPTIONS.map((item) => item.id));

export async function POST(request) {
  try {
    const auth = await getAuthPayload();
    if (!auth) {
      return Response.json({ success: false, message: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    const size = typeof body?.size === "string" ? body.size : "1024x1024";

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

    const imageUrl = await generateAndStoreImage({
      prompt,
      size,
      signal: request.signal,
    });

    return Response.json({ success: true, imageUrl });
  } catch (error) {
    console.error("[Media] generate image:", error);
    return Response.json(
      { success: false, message: error instanceof Error ? error.message : "图片生成失败" },
      { status: 500 }
    );
  }
}
