import {
  AUDIO_MODEL,
  IMAGE_MODEL,
} from "./models";
import { VIDEO_ENHANCEMENT_MODEL, VIDEO_ENHANCEMENT_MODEL_NAME } from "./videoEnhancement";

export const MEDIA_WORKSPACES = Object.freeze([
  Object.freeze({
    id: IMAGE_MODEL,
    name: "GPT Image 2.5 · Qwen Image",
    label: "图片生成",
    kind: "image",
    description: "用文字描绘画面，或上传参考图片进行编辑。",
    href: "/media/image",
  }),
  Object.freeze({
    id: AUDIO_MODEL,
    name: "语音合成",
    label: "语音合成",
    kind: "audio",
    description: "使用 Qwen、MiniMax 或豆包，将文字转为自然语音，选择音色或复刻自己的声音。",
    href: "/media/audio",
  }),
  Object.freeze({
    id: VIDEO_ENHANCEMENT_MODEL,
    name: VIDEO_ENHANCEMENT_MODEL_NAME,
    label: "画质增强",
    kind: "enhancement",
    description: "上传已有视频，提升清晰度与画面细节。",
    href: "/media/video-enhancement",
  }),
]);
