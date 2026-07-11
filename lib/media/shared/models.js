export const IMAGE_MODEL = "gpt-image-2";
export const VIDEO_MODEL = "doubao-seedance-2-0-mini-260615";

export const IMAGE_MODEL_NAME = "GPT Image 2";
export const VIDEO_MODEL_NAME = "Seedance 2.0 Mini";
export const IMAGE_PROMPT_MAX_LENGTH = 32000;
export const IMAGE_EDIT_MAX_BYTES = 25 * 1024 * 1024;
export const IMAGE_EDIT_ACCEPTED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const VIDEO_PROMPT_MAX_LENGTH = 32000;
export const VIDEO_FRAME_MAX_BYTES = 25 * 1024 * 1024;
export const VIDEO_FRAME_ACCEPTED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];

export const IMAGE_SIZE_OPTIONS = [
  { id: "auto", label: "自动" },
  { id: "1024x1024", label: "正方形 1024×1024" },
  { id: "1536x1024", label: "横版 1536×1024" },
  { id: "1024x1536", label: "竖版 1024×1536" },
];

export const VIDEO_ASPECT_RATIO_OPTIONS = [
  { id: "adaptive", label: "智能适配" },
  { id: "16:9", label: "横屏 16:9" },
  { id: "4:3", label: "横屏 4:3" },
  { id: "9:16", label: "竖屏 9:16" },
  { id: "1:1", label: "方形 1:1" },
  { id: "3:4", label: "竖屏 3:4" },
  { id: "21:9", label: "宽屏 21:9" },
];

export const VIDEO_DURATION_OPTIONS = [
  { id: -1, label: "智能" },
  { id: 4, label: "4 秒" },
  { id: 5, label: "5 秒" },
  { id: 8, label: "8 秒" },
  { id: 10, label: "10 秒" },
  { id: 15, label: "15 秒" },
];

export const VIDEO_RESOLUTION_OPTIONS = [
  { id: "480p", label: "480p" },
  { id: "720p", label: "720p" },
];
