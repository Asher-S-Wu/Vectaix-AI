import { modelAccessResponse } from "@/lib/server/guest/access";
import { getAuthPayload } from "@/lib/auth";
import dbConnect from "@/lib/db";
import { generateAndStoreImage } from "@/lib/media/server/qwenImage";
import { IMAGE_MODEL, IMAGE_PROMPT_MAX_LENGTH, IMAGE_SIZE_OPTIONS } from "@/lib/media/shared/models";
import {
  beginMediaWriteLease,
  endMediaWriteLease,
} from "@/lib/media/server/userOperationLeases";

const ALLOWED_SIZES = new Set(IMAGE_SIZE_OPTIONS.map((item) => item.id));

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

    const body = await request.json();
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    const size = typeof body?.size === "string" ? body.size : "auto";

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

    mediaWriteLease = await beginMediaWriteLease(auth.userId);
    const imageUrl = await generateAndStoreImage({
      userId: auth.userId,
      prompt,
      size,
      signal: request.signal,
      mediaWriteLease,
    });

    return Response.json({ success: true, imageUrl });
  } catch (error) {
    console.error("[Media] generate image:", error);
    return Response.json(
      { success: false, message: error instanceof Error ? error.message : "图片生成失败" },
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
        console.error("[Media] release image write lease:", error);
      });
    }
  }
}
