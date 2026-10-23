import { IMAGE_MODEL } from "./models";
import { FISH_AUDIO_MODEL, FISH_AUDIO_MODEL_LABEL } from "./fishAudio";

export const MEDIA_WORKSPACES = Object.freeze([
  Object.freeze({
    id: IMAGE_MODEL,
    name: "GPT Image 2.5",
    label: "图片生成",
    kind: "image",
    description: "用文字描绘画面，或上传参考图片进行编辑。",
    href: "/media/image",
  }),
  Object.freeze({
    id: FISH_AUDIO_MODEL,
    name: FISH_AUDIO_MODEL_LABEL,
    label: "语音合成",
    kind: "audio",
    description: "使用 Fish Audio S2.1 Pro Free，将文字转为自然语音。",
    href: "/media/audio",
  }),
]);
