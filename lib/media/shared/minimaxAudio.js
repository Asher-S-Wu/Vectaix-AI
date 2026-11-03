export const MINIMAX_AUDIO_MODEL = 'speech-2.8-hd';
export const MINIMAX_AUDIO_MODEL_LABEL = 'MiniMax Speech 2.8 HD';
export const MINIMAX_AUDIO_TEXT_MAX_LENGTH = 10000;
export const MINIMAX_AUDIO_FORMATS = Object.freeze(['mp3', 'wav']);
export const MINIMAX_AUDIO_SAMPLE_RATES = Object.freeze([8000, 16000, 22050, 24000, 32000, 44100]);
export const MINIMAX_AUDIO_BITRATES = Object.freeze([32000, 64000, 128000, 256000]);
export const MINIMAX_AUDIO_EMOTIONS = Object.freeze(['auto', 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'calm']);
export const MINIMAX_SOUND_EFFECTS = Object.freeze(['none', 'spacious_echo', 'auditorium_echo', 'lofi_telephone', 'robotic']);
export const MINIMAX_TEXT_NORMALIZATION_MODES = Object.freeze(['off', 'basic', 'quality']);
// MiniMax language_boost values mapped to BCP 47 codes for display names.
export const MINIMAX_LANGUAGE_BOOSTS = Object.freeze({
  auto: '', Chinese: 'zh', 'Chinese,Yue': 'yue', English: 'en', Japanese: 'ja', Korean: 'ko', French: 'fr', German: 'de',
  Spanish: 'es', Portuguese: 'pt', Italian: 'it', Russian: 'ru', Arabic: 'ar', Turkish: 'tr', Dutch: 'nl', Ukrainian: 'uk',
  Vietnamese: 'vi', Indonesian: 'id', Thai: 'th', Polish: 'pl', Romanian: 'ro', Greek: 'el', Czech: 'cs', Finnish: 'fi',
  Hindi: 'hi', Bulgarian: 'bg', Danish: 'da', Hebrew: 'he', Malay: 'ms', Persian: 'fa', Slovak: 'sk', Swedish: 'sv',
  Croatian: 'hr', Filipino: 'fil', Hungarian: 'hu', Norwegian: 'no', Slovenian: 'sl', Catalan: 'ca', Nynorsk: 'nn',
  Tamil: 'ta', Afrikaans: 'af',
});
export const MINIMAX_VOICE_ID_PATTERN = /^(?=\S)[^\p{Cc}"'\\/<>]{1,256}(?<=\S)$/u;
export const MINIMAX_VOICE_SAMPLE_MAX_BYTES = 20 * 1024 * 1024;
export const MINIMAX_VOICE_SAMPLE_MIN_SECONDS = 10;
export const MINIMAX_VOICE_SAMPLE_MAX_SECONDS = 300;
export const MINIMAX_VOICE_MAX_COUNT = 20;
export const MINIMAX_CLONE_ACTIVATION_MS = 7 * 24 * 60 * 60 * 1000;
export const MINIMAX_AUDIO_DEFAULTS = Object.freeze({
  enabled: false, baseUrl: 'https://api.minimax.cn', provider: 'minimax',
  model: MINIMAX_AUDIO_MODEL, voiceId: '', format: 'mp3', sampleRate: 32000, bitrate: 128000,
  speed: 1, volume: 1, pitch: 0, emotion: 'auto', languageBoost: 'auto', soundEffect: 'none', textNormalization: 'off',
});

const fail = message => Object.assign(new Error(message), { status: 400 });
function number(body, key, min, max) {
  const value = body[key] === undefined ? MINIMAX_AUDIO_DEFAULTS[key] : body[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw fail(`${key} 参数须在 ${min} 到 ${max} 之间`);
  return value;
}
function choice(body, key, options, message) {
  const value = body[key] === undefined ? MINIMAX_AUDIO_DEFAULTS[key] : body[key];
  if (!options.includes(value)) throw fail(message);
  return value;
}

export function parseMiniMaxSpeechInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('请求内容格式错误');
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const voiceId = typeof body.voiceId === 'string' ? body.voiceId.trim() : '';
  if (!text || text.length > MINIMAX_AUDIO_TEXT_MAX_LENGTH) throw fail(`朗读文字需要在 1 至 ${MINIMAX_AUDIO_TEXT_MAX_LENGTH} 字之间`);
  if (!MINIMAX_VOICE_ID_PATTERN.test(voiceId)) throw fail('请选择有效音色');
  if (body.model !== undefined && body.model !== MINIMAX_AUDIO_MODEL) throw fail('请选择 MiniMax Speech 2.8 HD 模型');
  const pitch = number(body, 'pitch', -12, 12);
  if (!Number.isInteger(pitch)) throw fail('pitch 参数须为整数');
  return {
    text, voiceId,
    format: choice(body, 'format', MINIMAX_AUDIO_FORMATS, '请选择 MP3 或 WAV 音频格式'),
    sampleRate: choice(body, 'sampleRate', MINIMAX_AUDIO_SAMPLE_RATES, '请选择有效的采样率'),
    bitrate: choice(body, 'bitrate', MINIMAX_AUDIO_BITRATES, '请选择有效的比特率'),
    speed: number(body, 'speed', 0.5, 2),
    volume: number(body, 'volume', 0.1, 10),
    pitch,
    emotion: choice(body, 'emotion', MINIMAX_AUDIO_EMOTIONS, '请选择有效的情绪'),
    languageBoost: choice(body, 'languageBoost', Object.keys(MINIMAX_LANGUAGE_BOOSTS), '请选择有效的语言增强'),
    soundEffect: choice(body, 'soundEffect', MINIMAX_SOUND_EFFECTS, '请选择有效的音效'),
    textNormalization: choice(body, 'textNormalization', MINIMAX_TEXT_NORMALIZATION_MODES, '请选择有效的文本规范化方式'),
  };
}

export function minimaxCloneStatus({ activatedAt, createdAt }, now = Date.now()) {
  if (activatedAt) return 'trained';
  return now - new Date(createdAt).getTime() < MINIMAX_CLONE_ACTIVATION_MS ? 'pending_activation' : 'expired';
}
