export const ELEVENLABS_AUDIO_MODEL = 'eleven_multilingual_v2';
export const ELEVENLABS_AUDIO_MODEL_LABEL = 'ElevenLabs Multilingual v2';
export const ELEVENLABS_AUDIO_TEXT_MAX_LENGTH = 10000;
export const ELEVENLABS_AUDIO_FORMATS = Object.freeze(['mp3', 'wav']);
export const ELEVENLABS_AUDIO_SAMPLE_RATES = Object.freeze({
  mp3: Object.freeze([22050, 44100]),
  wav: Object.freeze([16000, 22050, 24000, 44100, 48000]),
});
export const ELEVENLABS_VOICE_ID_PATTERN = /^[a-zA-Z0-9_-]{20,64}$/;
export const ELEVENLABS_VOICE_SAMPLE_MAX_BYTES = 20 * 1024 * 1024;
export const ELEVENLABS_VOICE_SAMPLE_MIN_SECONDS = 10;
export const ELEVENLABS_VOICE_SAMPLE_MAX_SECONDS = 300;
export const ELEVENLABS_VOICE_MAX_COUNT = 20;
export const ELEVENLABS_AUDIO_DEFAULTS = Object.freeze({
  enabled: false, baseUrl: 'https://api.elevenlabs.io', provider: 'elevenlabs',
  model: ELEVENLABS_AUDIO_MODEL, voiceId: '', format: 'mp3', sampleRate: 44100,
  speed: 1, stability: 0.5, similarityBoost: 0.75, style: 0, useSpeakerBoost: true,
});

const fail = message => Object.assign(new Error(message), { status: 400 });
function number(body, key, min, max) {
  const value = body[key] === undefined ? ELEVENLABS_AUDIO_DEFAULTS[key] : body[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw fail(`${key} 参数须在 ${min} 到 ${max} 之间`);
  return value;
}

export function parseElevenLabsSpeechInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('请求内容格式错误');
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const voiceId = typeof body.voiceId === 'string' ? body.voiceId.trim() : '';
  const format = body.format === undefined ? 'mp3' : body.format;
  const sampleRate = body.sampleRate === undefined ? 44100 : body.sampleRate;
  if (!text || text.length > ELEVENLABS_AUDIO_TEXT_MAX_LENGTH) throw fail(`朗读文字需要在 1 至 ${ELEVENLABS_AUDIO_TEXT_MAX_LENGTH} 字之间`);
  if (!ELEVENLABS_VOICE_ID_PATTERN.test(voiceId)) throw fail('请选择有效音色');
  if (body.model !== undefined && body.model !== ELEVENLABS_AUDIO_MODEL) throw fail('请选择 ElevenLabs Multilingual v2 模型');
  if (!ELEVENLABS_AUDIO_FORMATS.includes(format)) throw fail('请选择 MP3 或 WAV 音频格式');
  if (!ELEVENLABS_AUDIO_SAMPLE_RATES[format].includes(sampleRate)) throw fail('请选择与音频格式匹配的采样率');
  const useSpeakerBoost = body.useSpeakerBoost === undefined ? true : body.useSpeakerBoost;
  if (typeof useSpeakerBoost !== 'boolean') throw fail('请选择是否启用说话人增强');
  return {
    text, voiceId, format, sampleRate,
    speed: number(body, 'speed', 0.7, 1.2), stability: number(body, 'stability', 0, 1),
    similarityBoost: number(body, 'similarityBoost', 0, 1), style: number(body, 'style', 0, 1), useSpeakerBoost,
  };
}
