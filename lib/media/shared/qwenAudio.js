export const QWEN_AUDIO_MODEL = 'qwen-audio-3.1-tts-plus';
export const QWEN_AUDIO_MODEL_LABEL = 'Qwen Audio 3.1 TTS Plus';
export const QWEN_AUDIO_BASE_URL = 'https://ws-2t7yj3g991jc5yo6.ap-southeast-1.maas.aliyuncs.com';
export const QWEN_AUDIO_TEXT_MAX_LENGTH = 20000;
export const QWEN_AUDIO_SAMPLE_RATES = Object.freeze([8000, 16000, 22050, 24000, 44100, 48000]);
export const QWEN_VOICE_SAMPLE_MAX_BYTES = 10 * 1024 * 1024;
export const QWEN_VOICE_MAX_COUNT = 20;
export const QWEN_BUILTIN_VOICES = Object.freeze([
  Object.freeze({ profileId: 'longanhuan_v3.1', voiceId: 'longanhuan_v3.1', displayName: '龙安欢 · Long Anhuan', status: 'trained', languages: ['zh'], builtin: true }),
]);
export const QWEN_AUDIO_DEFAULTS = Object.freeze({ enabled: false, baseUrl: QWEN_AUDIO_BASE_URL, provider: 'qwen', model: QWEN_AUDIO_MODEL, voiceId: 'longanhuan_v3.1', format: 'mp3', sampleRate: 24000, speed: 1, volume: 50 });

export function isQwenClonedVoice(voiceId) {
  return typeof voiceId === 'string' && voiceId.length <= 256 && /^qwen-audio-3\.1-tts-plus-[a-zA-Z0-9]{1,10}-[a-zA-Z0-9_-]+$/.test(voiceId);
}

export function parseQwenSpeechInput(body, { allowEmptyVoice = false } = {}) {
  const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('请求内容格式错误');
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const voiceId = typeof body.voiceId === 'string' ? body.voiceId.trim() : '';
  if (!text || text.length > QWEN_AUDIO_TEXT_MAX_LENGTH) fail(`朗读文字需要在 1 至 ${QWEN_AUDIO_TEXT_MAX_LENGTH} 字之间`);
  if (!(allowEmptyVoice && !voiceId) && !QWEN_BUILTIN_VOICES.some(voice => voice.voiceId === voiceId) && !isQwenClonedVoice(voiceId)) fail('请选择有效的 Qwen 音色');
  if (body.model !== undefined && body.model !== QWEN_AUDIO_MODEL) fail('请选择 Qwen Audio 3.1 TTS Plus 模型');
  const { format = 'mp3', sampleRate = 24000, speed = 1, volume = 50 } = body;
  if (!['mp3', 'wav'].includes(format)) fail('请选择 MP3 或 WAV 音频格式');
  if (!QWEN_AUDIO_SAMPLE_RATES.includes(sampleRate)) fail('请选择有效的 Qwen 采样率');
  if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0.5 || speed > 2) fail('语速须在 0.5 到 2 之间');
  if (!Number.isInteger(volume) || volume < 0 || volume > 100) fail('音量须为 0 到 100 的整数');
  return { text, voiceId, format, sampleRate, speed, volume };
}

export function validateQwenBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !/^ws-[a-z0-9]+\.ap-southeast-1\.maas\.aliyuncs\.com$/.test(url.hostname) || url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw Object.assign(new Error('请填写阿里云新加坡业务空间的 HTTPS 根地址'), { status: 400 });
  }
  return url.origin;
}

