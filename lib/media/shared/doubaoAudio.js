export const DOUBAO_AUDIO_MODEL = "seed-audio-1.0";
export const DOUBAO_AUDIO_MODEL_NAME = "Seed Audio 1.0";

export const DOUBAO_AUDIO_TEXT_MAX_LENGTH = 2600;
export const DOUBAO_AUDIO_INSTRUCTION_MAX_LENGTH = 300;
export const DOUBAO_AUDIO_PROMPT_MAX_LENGTH = 3000;
export const DOUBAO_AUDIO_OUTPUT_MAX_BYTES = 32 * 1024 * 1024;
export const DOUBAO_VOICE_DISPLAY_NAME_MAX_LENGTH = 40;
export const DOUBAO_CUSTOM_VOICE_MAX_COUNT = 20;

export const DOUBAO_AUDIO_FORMAT_OPTIONS = Object.freeze([
  Object.freeze({ id: "mp3", label: "MP3", mimeType: "audio/mpeg" }),
  Object.freeze({ id: "wav", label: "WAV", mimeType: "audio/wav" }),
]);
export const DOUBAO_AUDIO_FORMAT_IDS = Object.freeze(
  DOUBAO_AUDIO_FORMAT_OPTIONS.map((item) => item.id),
);

export const DOUBAO_AUDIO_SAMPLE_RATE_OPTIONS = Object.freeze([
  Object.freeze({ id: 16000, label: "16 kHz" }),
  Object.freeze({ id: 24000, label: "24 kHz" }),
  Object.freeze({ id: 32000, label: "32 kHz" }),
  Object.freeze({ id: 44100, label: "44.1 kHz" }),
  Object.freeze({ id: 48000, label: "48 kHz" }),
]);
export const DOUBAO_AUDIO_SAMPLE_RATE_IDS = Object.freeze(
  DOUBAO_AUDIO_SAMPLE_RATE_OPTIONS.map((item) => item.id),
);
export const DOUBAO_AUDIO_DEFAULT_SAMPLE_RATE = 48000;

export const DOUBAO_AUDIO_SPEECH_RATE_MIN = -50;
export const DOUBAO_AUDIO_SPEECH_RATE_MAX = 100;
export const DOUBAO_AUDIO_LOUDNESS_RATE_MIN = -50;
export const DOUBAO_AUDIO_LOUDNESS_RATE_MAX = 100;
export const DOUBAO_AUDIO_PITCH_RATE_MIN = -12;
export const DOUBAO_AUDIO_PITCH_RATE_MAX = 12;

const REFERENCE_PROMPT_PREFIX = "使用 @音频1 的声音朗读以下内容。";
export const DOUBAO_AUDIO_REFERENCE_MARKER_PATTERN = /@音频\d+/u;

export function buildDoubaoTextPrompt({ text, instruction }) {
  const expression = instruction ? `\n表达要求：${instruction}` : "";
  return `${REFERENCE_PROMPT_PREFIX}${expression}\n正文：${text}`;
}

export function getDoubaoAudioFormat(formatId) {
  return DOUBAO_AUDIO_FORMAT_OPTIONS.find((item) => item.id === formatId) || null;
}
