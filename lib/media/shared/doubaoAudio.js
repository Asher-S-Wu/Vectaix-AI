export const DOUBAO_AUDIO_MODEL = "seed-audio-1.0";

export const DOUBAO_AUDIO_MODES = Object.freeze([
  Object.freeze({ id: "text", label: "纯文本" }),
  Object.freeze({ id: "audio-reference", label: "参考音频" }),
]);

export const DOUBAO_AUDIO_MODE_IDS = Object.freeze(
  DOUBAO_AUDIO_MODES.map((item) => item.id),
);

export const DOUBAO_AUDIO_FORMAT_OPTIONS = Object.freeze([
  Object.freeze({ id: "mp3", label: "MP3", upstream: "mp3", mimeType: "audio/mpeg" }),
  Object.freeze({ id: "wav", label: "WAV", upstream: "wav", mimeType: "audio/wav" }),
]);

export const DOUBAO_AUDIO_FORMAT_IDS = Object.freeze(
  DOUBAO_AUDIO_FORMAT_OPTIONS.map((item) => item.id),
);

export const DOUBAO_AUDIO_TEXT_MAX_LENGTH = 3000;
export const DOUBAO_AUDIO_REFERENCE_MAX_COUNT = 3;
export const DOUBAO_AUDIO_REFERENCE_MAX_BYTES = 10 * 1024 * 1024;
export const DOUBAO_AUDIO_REFERENCE_MAX_DURATION_SECONDS = 30;
export const DOUBAO_AUDIO_OUTPUT_MAX_DURATION_SECONDS = 120;

export const DOUBAO_AUDIO_REFERENCE_EXTENSIONS = Object.freeze(["mp3", "wav", "ogg"]);

export function getDoubaoAudioFormat(formatId) {
  return DOUBAO_AUDIO_FORMAT_OPTIONS.find((item) => item.id === formatId) || null;
}
