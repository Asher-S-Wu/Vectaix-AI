import { getAuthPayload } from "@/lib/auth";
import { generateAndStoreVideo } from "@/lib/media/server/zenmux/videos";
import {
  VIDEO_ASPECT_RATIO_OPTIONS,
  VIDEO_DURATION_OPTIONS,
  VIDEO_FRAME_ACCEPTED_MIME_TYPES,
  VIDEO_FRAME_MAX_BYTES,
  VIDEO_PERSON_GENERATION_OPTIONS,
  VIDEO_PROMPT_MAX_LENGTH,
  VIDEO_RESOLUTION_OPTIONS,
} from "@/lib/media/shared/models";

const ALLOWED_ASPECT_RATIOS = new Set(VIDEO_ASPECT_RATIO_OPTIONS.map((item) => item.id));
const ALLOWED_DURATIONS = new Set(VIDEO_DURATION_OPTIONS.map((item) => item.id));
const ALLOWED_RESOLUTIONS = new Set(VIDEO_RESOLUTION_OPTIONS.map((item) => item.id));
const ALLOWED_FRAME_MIME_TYPES = new Set(VIDEO_FRAME_ACCEPTED_MIME_TYPES);
const ALLOWED_PERSON_GENERATION = new Set(VIDEO_PERSON_GENERATION_OPTIONS.map((item) => item.id));

function readOptionalString(formData, name) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalNumber(formData, name) {
  const value = readOptionalString(formData, name);
  if (!value) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function readBoolean(formData, name, defaultValue) {
  const value = readOptionalString(formData, name);
  if (!value) return defaultValue;
  return value === "true";
}

function readOptionalImage(formData, name) {
  const value = formData.get(name);
  return value instanceof File && value.size > 0 ? value : null;
}

function validateFrameImage(image, label) {
  if (!image) return "";
  if (!ALLOWED_FRAME_MIME_TYPES.has(image.type)) {
    return `${label}仅支持 PNG、JPG、WEBP 图片`;
  }
  if (image.size > VIDEO_FRAME_MAX_BYTES) {
    return `${label}大小不能超过 25MB`;
  }
  return "";
}

export async function POST(request) {
  try {
    const auth = await getAuthPayload();
    if (!auth) {
      return Response.json({ success: false, message: "未登录" }, { status: 401 });
    }

    const formData = await request.formData();
    const prompt = readOptionalString(formData, "prompt");
    const negativePrompt = readOptionalString(formData, "negativePrompt");
    const aspectRatio = readOptionalString(formData, "aspectRatio") || "16:9";
    const durationSeconds = Number(readOptionalString(formData, "durationSeconds"));
    const resolution = readOptionalString(formData, "resolution") || "720p";
    const generateAudio = readBoolean(formData, "generateAudio", true);
    const enhancePrompt = readBoolean(formData, "enhancePrompt", false);
    const personGeneration = readOptionalString(formData, "personGeneration");
    const seed = readOptionalNumber(formData, "seed");
    const fps = readOptionalNumber(formData, "fps");
    const image = readOptionalImage(formData, "image");
    const lastFrame = readOptionalImage(formData, "lastFrame");

    if (!prompt && !image) {
      return Response.json({ success: false, message: "请输入视频描述" }, { status: 400 });
    }

    if (prompt.length > VIDEO_PROMPT_MAX_LENGTH) {
      return Response.json(
        { success: false, message: `描述最多支持 ${VIDEO_PROMPT_MAX_LENGTH} 个字符` },
        { status: 400 }
      );
    }

    if (negativePrompt.length > VIDEO_PROMPT_MAX_LENGTH) {
      return Response.json(
        { success: false, message: `负面描述最多支持 ${VIDEO_PROMPT_MAX_LENGTH} 个字符` },
        { status: 400 }
      );
    }

    if (!ALLOWED_ASPECT_RATIOS.has(aspectRatio)) {
      return Response.json({ success: false, message: "不支持的画面比例" }, { status: 400 });
    }

    if (!ALLOWED_DURATIONS.has(durationSeconds)) {
      return Response.json({ success: false, message: "不支持的视频时长" }, { status: 400 });
    }

    if (!ALLOWED_RESOLUTIONS.has(resolution)) {
      return Response.json({ success: false, message: "不支持的分辨率" }, { status: 400 });
    }

    if (!ALLOWED_PERSON_GENERATION.has(personGeneration)) {
      return Response.json({ success: false, message: "不支持的人物生成设置" }, { status: 400 });
    }

    if (Number.isNaN(seed)) {
      return Response.json({ success: false, message: "种子必须是数字" }, { status: 400 });
    }

    if (Number.isNaN(fps) || (fps !== undefined && (!Number.isInteger(fps) || fps <= 0))) {
      return Response.json({ success: false, message: "帧率必须是正整数" }, { status: 400 });
    }

    if (lastFrame && !image) {
      return Response.json({ success: false, message: "使用尾帧时需要同时上传首帧" }, { status: 400 });
    }

    const imageError = validateFrameImage(image, "首帧图片");
    if (imageError) {
      return Response.json({ success: false, message: imageError }, { status: 400 });
    }

    const lastFrameError = validateFrameImage(lastFrame, "尾帧图片");
    if (lastFrameError) {
      return Response.json({ success: false, message: lastFrameError }, { status: 400 });
    }

    const videoUrl = await generateAndStoreVideo({
      prompt,
      image: image || undefined,
      lastFrame: lastFrame || undefined,
      aspectRatio,
      durationSeconds,
      resolution,
      generateAudio,
      negativePrompt,
      enhancePrompt,
      personGeneration,
      seed,
      fps,
      sampleCount: 1,
      signal: request.signal,
    });

    return Response.json({ success: true, videoUrl });
  } catch (error) {
    console.error("[Media] generate video:", error);
    return Response.json(
      { success: false, message: error instanceof Error ? error.message : "视频生成失败" },
      { status: 500 }
    );
  }
}
