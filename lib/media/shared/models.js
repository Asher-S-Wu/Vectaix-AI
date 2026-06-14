export const IMAGE_MODEL = "openai/gpt-image-2";
export const VIDEO_MODEL = "bytedance/doubao-seedance-2.0";

export const IMAGE_MODEL_NAME = "GPT Image 2";
export const VIDEO_MODEL_NAME = "Seedance 2.0";
export const IMAGE_PROMPT_MAX_LENGTH = 32000;
export const IMAGE_EDIT_MAX_BYTES = 25 * 1024 * 1024;
export const IMAGE_EDIT_ACCEPTED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const VIDEO_PROMPT_MAX_LENGTH = 32000;
export const VIDEO_FRAME_MAX_BYTES = 25 * 1024 * 1024;
export const VIDEO_FRAME_ACCEPTED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];

export const IMAGE_ICON_URL =
  "https://cdn.marmot-cloud.com/storage/zenmux/2025/10/15/Mm7IePA/Property-1GPT.svg";

export const VIDEO_ICON_URL =
  "https://cdn.marmot-cloud.com/storage/zenmux/2026/04/08/YSFtnJU/Property-1Bytedance.svg";

export const IMAGE_SIZE_OPTIONS = [
  { id: "auto", label: "自动" },
  { id: "1024x1024", label: "正方形 1024×1024" },
  { id: "1536x1024", label: "横版 1536×1024" },
  { id: "1024x1536", label: "竖版 1024×1536" },
];

export const VIDEO_ASPECT_RATIO_OPTIONS = [
  { id: "16:9", label: "横屏 16:9" },
  { id: "9:16", label: "竖屏 9:16" },
  { id: "1:1", label: "方形 1:1" },
];

export const VIDEO_DURATION_OPTIONS = [
  { id: 5, label: "5 秒" },
  { id: 8, label: "8 秒" },
];

export const VIDEO_RESOLUTION_OPTIONS = [
  { id: "720p", label: "720p" },
  { id: "1080p", label: "1080p" },
];

export const VIDEO_PERSON_GENERATION_OPTIONS = [
  { id: "", label: "默认" },
  { id: "dont_allow", label: "不生成真人" },
  { id: "allow_adult", label: "允许成年人" },
];

export function parseModelSlug(slug) {
  const index = slug.indexOf("/");
  if (index < 0) {
    return { provider: slug, model: slug };
  }
  return {
    provider: slug.slice(0, index),
    model: slug.slice(index + 1),
  };
}
