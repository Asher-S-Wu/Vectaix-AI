import {
  AUDIO_MODEL,
  IMAGE_MODEL,
  IMAGE_MODEL_NAME,
  VIDEO_MODEL,
  VIDEO_MODEL_NAME,
} from "./models";
import { MINIMAX_AUDIO_DEFAULT_MODEL } from "./minimaxAudio";
import { DOUBAO_AUDIO_MODEL } from "./doubaoAudio";
import { VIDEO_ENHANCEMENT_MODEL, VIDEO_ENHANCEMENT_MODEL_NAME } from "./videoEnhancement";

export const MEDIA_WORKSPACES = Object.freeze([
  Object.freeze({
    id: IMAGE_MODEL,
    name: IMAGE_MODEL_NAME,
    label: "图片生成",
    kind: "image",
    description: "用文字描绘画面，或上传参考图片进行编辑。",
    href: "/media/image",
  }),
  Object.freeze({
    id: VIDEO_MODEL,
    name: VIDEO_MODEL_NAME,
    label: "视频生成",
    kind: "video",
    description: "从文字、首帧或参考图出发，生成与编辑视频。",
    href: "/media/video",
  }),
  Object.freeze({
    id: AUDIO_MODEL,
    name: "Qwen TTS",
    label: "Qwen 语音",
    kind: "audio",
    description: "将文字转为自然语音，选择音色或复刻自己的声音。",
    href: "/media/audio",
  }),
  Object.freeze({
    id: MINIMAX_AUDIO_DEFAULT_MODEL,
    name: "MiniMax Speech 2.8",
    label: "MiniMax 语音",
    kind: "audio",
    description: "创作富有表现力的配音，调整语速、音调与情绪。",
    href: "/media/minimax-audio",
  }),
  Object.freeze({
    id: DOUBAO_AUDIO_MODEL,
    name: "Doubao Seed Audio 1.0",
    label: "豆包语音",
    kind: "audio",
    description: "结合参考声音与表达要求，生成符合场景的语音。",
    href: "/media/doubao-audio",
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
