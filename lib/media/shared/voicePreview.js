export const VOICE_PREVIEW_TEXT_ZH = "你好，这是我的声音。";
export const VOICE_PREVIEW_TEXT_EN = "Hello, this is my voice.";

export function getVoicePreviewText(languages) {
  const ids = Array.isArray(languages) ? languages : [];
  if (ids.length > 0 && !ids.includes("zh")) return VOICE_PREVIEW_TEXT_EN;
  return VOICE_PREVIEW_TEXT_ZH;
}
