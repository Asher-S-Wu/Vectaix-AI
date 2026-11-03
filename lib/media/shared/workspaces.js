import { IMAGE_MODEL } from "./models";
import { translate } from "../../shared/i18n.mjs";

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
    id: "speech",
    name: "ElevenLabs · MiniMax",
    label: "语音合成",
    kind: "audio",
    description: "使用 ElevenLabs 或 MiniMax，克隆声音并合成自然语音。",
    href: "/media/audio",
  }),
]);

export function getMediaWorkspaces(locale) {
  return MEDIA_WORKSPACES.map(item => ({
    ...item,
    label: item.kind === "image" ? translate(locale, "图片生成", "Image generation") : translate(locale, "语音合成", "Text to speech"),
    description: item.kind === "image"
      ? translate(locale, "用文字描绘画面，或上传参考图片进行编辑。", "Describe an image to generate it, or upload reference images to edit.")
      : translate(locale, "使用 ElevenLabs 或 MiniMax，克隆声音并合成自然语音。", "Clone voices and generate natural speech with ElevenLabs or MiniMax."),
  }));
}
