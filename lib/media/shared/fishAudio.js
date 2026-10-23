export const FISH_AUDIO_MODEL = "s2.1-pro-free";
export const FISH_AUDIO_MODEL_LABEL = "Fish Audio S2.1 Pro";
export const FISH_AUDIO_TEXT_MAX_LENGTH = 15000;
export const FISH_AUDIO_FORMATS = Object.freeze(["mp3", "wav"]);
export const FISH_AUDIO_DEFAULT_SAMPLE_RATE = 44100;
export const FISH_AUDIO_SAMPLE_RATES = Object.freeze({
  mp3: Object.freeze([32000, 44100]),
  wav: Object.freeze([8000, 16000, 24000, 32000, 44100]),
});
export const FISH_VOICE_SAMPLE_MAX_BYTES = 20 * 1024 * 1024;
export const FISH_VOICE_SAMPLE_MIN_SECONDS = 10;
export const FISH_VOICE_SAMPLE_MAX_SECONDS = 300;
export const FISH_VOICE_MAX_COUNT = 20;

function inputError(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function readNumber(body, key, defaultValue, min, max) {
  const value = body[key] === undefined ? defaultValue : body[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw inputError(`${key} 参数须在 ${min} 到 ${max} 之间`);
  }
  return value;
}

export function parseFishSpeechInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw inputError("请求内容格式错误");
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const voiceId = typeof body.voiceId === "string" ? body.voiceId.trim() : "";
  const format = body.format === undefined ? "mp3" : body.format;
  const sampleRate = body.sampleRate === undefined ? FISH_AUDIO_DEFAULT_SAMPLE_RATE : body.sampleRate;
  if (!text) throw inputError("请输入需要朗读的文字");
  if (text.length > FISH_AUDIO_TEXT_MAX_LENGTH) throw inputError(`朗读文字最多 ${FISH_AUDIO_TEXT_MAX_LENGTH} 个字符`);
  if (!/^[a-f0-9]{32}$/i.test(voiceId)) throw inputError("请选择有效音色");
  if (body.model !== undefined && body.model !== FISH_AUDIO_MODEL) throw inputError("请选择 Fish Audio S2.1 Pro 模型");
  if (!FISH_AUDIO_FORMATS.includes(format)) throw inputError("请选择 MP3 或 WAV 音频格式");
  if (!FISH_AUDIO_SAMPLE_RATES[format].includes(sampleRate)) throw inputError("请选择与音频格式匹配的采样率");
  return {
    text,
    voiceId,
    format,
    sampleRate,
    speed: readNumber(body, "speed", 1, 0.5, 2),
    volume: readNumber(body, "volume", 0, -20, 20),
    temperature: readNumber(body, "temperature", 0.7, 0, 1),
    topP: readNumber(body, "topP", 0.7, 0, 1),
  };
}
