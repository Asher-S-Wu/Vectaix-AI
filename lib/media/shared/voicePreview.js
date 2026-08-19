export const VOICE_PREVIEW_TEXT_ZH = "你好，这是我的声音。";
export const VOICE_PREVIEW_TEXT_EN = "Hello, this is my voice.";
export const VOICE_CLONE_DEMO_DEFAULT_TEXT = "你好，这是我的声音，很高兴认识你。现在听到的这段音频，就是用这个声音生成的试听效果。";

export function getVoicePreviewText(languages) {
  const ids = Array.isArray(languages) ? languages : [];
  if (ids.length > 0 && !ids.includes("zh")) return VOICE_PREVIEW_TEXT_EN;
  return VOICE_PREVIEW_TEXT_ZH;
}
