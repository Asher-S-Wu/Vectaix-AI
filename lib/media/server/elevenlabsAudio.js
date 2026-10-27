import { getMediaConnection } from '@/lib/server/media/settings';
import { ELEVENLABS_AUDIO_MODEL, ELEVENLABS_VOICE_ID_PATTERN, parseElevenLabsSpeechInput } from '@/lib/media/shared/elevenlabsAudio';

export class ElevenLabsAudioError extends Error {
  constructor(message, { status = 502, code = 'ELEVENLABS_AUDIO_ERROR', requestId = '', upstreamRejected = false } = {}) {
    super(message);
    this.name = 'ElevenLabsAudioError';
    Object.assign(this, { status, code, requestId, upstreamRejected });
  }
}
export function elevenlabsErrorStatus(error) {
  if (error?.name === 'AbortError') return 499;
  const status = Number(error?.status ?? error?.statusCode);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}
export function elevenlabsPublicMessage(error, defaultMessage) {
  if (error?.name === 'AbortError') return '操作已取消';
  return error instanceof ElevenLabsAudioError || elevenlabsErrorStatus(error) < 500 ? error.message : defaultMessage;
}
export async function resolveElevenLabsAudioConfig(options) {
  return getMediaConnection('audio', options);
}
async function readLimitedBytes(response, maximum) {
  if (Number(response.headers.get('content-length')) > maximum) {
    await response.body?.cancel();
    throw new ElevenLabsAudioError('ElevenLabs 返回内容超过大小限制');
  }
  if (!response.body) throw new ElevenLabsAudioError('ElevenLabs 返回了空内容');
  const chunks = [], reader = response.body.getReader();
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new ElevenLabsAudioError('ElevenLabs 返回内容超过大小限制');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}
async function elevenlabsRequest(path, { method = 'GET', body, headers, signal, onRequestDispatched, requireEnabled = true } = {}) {
  signal?.throwIfAborted();
  const config = await resolveElevenLabsAudioConfig({ requireEnabled });
  const timeout = AbortSignal.timeout(240000);
  signal?.throwIfAborted();
  onRequestDispatched?.();
  const response = await fetch(`${config.baseUrl}${path}`, {
    method, headers: { 'xi-api-key': config.apiKey, ...headers }, body,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout, redirect: 'error', cache: 'no-store',
  });
  if (!response.ok) {
    await response.body?.cancel();
    const messages = {
      400: 'ElevenLabs 未接受本次参数，请检查文字和音色',
      401: 'ElevenLabs 服务密钥无效', 402: 'ElevenLabs 服务账户余额不足',
      403: 'ElevenLabs 服务账户权限不足，请检查套餐与密钥权限',
      404: '该 ElevenLabs 音色已被删除', 422: 'ElevenLabs 未接受本次参数，请检查文字和音色',
      429: 'ElevenLabs 当前请求较多，请稍后再试',
    };
    throw new ElevenLabsAudioError(messages[response.status] || 'ElevenLabs 服务请求失败', {
      status: [401, 402].includes(response.status) ? 503 : response.status >= 500 ? 502 : response.status,
      code: `UPSTREAM_${response.status}`, requestId: response.headers.get('request-id') || '',
      upstreamRejected: response.status >= 400 && response.status < 500,
    });
  }
  return response;
}
async function readJson(response) {
  const bytes = await readLimitedBytes(response, 2 * 1024 * 1024);
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw new ElevenLabsAudioError('ElevenLabs 返回的数据格式有误'); }
}
export function buildElevenLabsSpeechPayload(input) {
  const parsed = parseElevenLabsSpeechInput(input);
  return {
    text: parsed.text, model_id: ELEVENLABS_AUDIO_MODEL,
    voice_settings: { stability: parsed.stability, similarity_boost: parsed.similarityBoost, style: parsed.style, speed: parsed.speed, use_speaker_boost: parsed.useSpeakerBoost },
    apply_text_normalization: 'auto',
  };
}
export async function synthesizeElevenLabsSpeech(input, { signal, onRequestDispatched, onUpstreamComplete } = {}) {
  const parsed = parseElevenLabsSpeechInput(input);
  const outputFormat = parsed.format === 'mp3' ? (parsed.sampleRate === 22050 ? 'mp3_22050_32' : 'mp3_44100_128') : `pcm_${parsed.sampleRate}`;
  const response = await elevenlabsRequest(`/v1/text-to-speech/${encodeURIComponent(parsed.voiceId)}?output_format=${outputFormat}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildElevenLabsSpeechPayload(parsed)), signal, onRequestDispatched,
  });
  if (!/^(audio\/|application\/octet-stream)/i.test(response.headers.get('content-type') || '')) {
    await response.body?.cancel();
    throw new ElevenLabsAudioError('ElevenLabs 返回内容并非音频');
  }
  let audioBuffer = await readLimitedBytes(response, 100 * 1024 * 1024);
  if (!audioBuffer.length) throw new ElevenLabsAudioError('ElevenLabs 返回了空音频');
  onUpstreamComplete?.();
  if (parsed.format === 'wav') {
    if (audioBuffer.length % 2) throw new ElevenLabsAudioError('ElevenLabs 返回的 PCM 音频格式有误');
    const header = Buffer.alloc(44);
    header.write('RIFF'); header.writeUInt32LE(36 + audioBuffer.length, 4); header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
    header.writeUInt32LE(parsed.sampleRate, 24); header.writeUInt32LE(parsed.sampleRate * 2, 28);
    header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(audioBuffer.length, 40);
    audioBuffer = Buffer.concat([header, audioBuffer]);
  }
  const characterHeader = response.headers.get('character-cost');
  const characters = Number(characterHeader);
  if (characterHeader === null || !Number.isSafeInteger(characters) || characters < 0) throw new ElevenLabsAudioError('ElevenLabs 返回的计费用量有误', { requestId: response.headers.get('request-id') || '' });
  return { audioBuffer, mimeType: parsed.format === 'wav' ? 'audio/wav' : 'audio/mpeg', bytes: Buffer.byteLength(parsed.text, 'utf8'), characters, requestId: response.headers.get('request-id') || '' };
}
function validateVoiceId(voiceId) {
  if (typeof voiceId !== 'string' || !ELEVENLABS_VOICE_ID_PATTERN.test(voiceId)) throw new ElevenLabsAudioError('音色编号无效', { status: 400, upstreamRejected: true });
}
function validateVoice(voice) {
  if (!voice || !ELEVENLABS_VOICE_ID_PATTERN.test(voice.voice_id) || typeof voice.name !== 'string') throw new ElevenLabsAudioError('ElevenLabs 返回的音色信息有误');
  return voice;
}
export function elevenlabsVoiceStatus(voice) {
  if (voice.voice_verification?.requires_verification && !voice.voice_verification.is_verified) return 'verification_required';
  if (['BAN', 'CAPTCHA', 'ENTERPRISE_BAN', 'ENTERPRISE_CAPTCHA'].includes(voice.safety_control)) return 'verification_required';
  return 'trained';
}
export function elevenlabsVoiceLanguages(voice) {
  return [...new Set([voice.labels?.language, ...(voice.verified_languages || []).map(item => item.language)].filter(Boolean))];
}
export async function getElevenLabsVoice(voiceId, { signal } = {}) {
  validateVoiceId(voiceId);
  return validateVoice(await readJson(await elevenlabsRequest(`/v1/voices/${encodeURIComponent(voiceId)}`, { signal })));
}
export async function listElevenLabsDefaultVoices({ signal } = {}) {
  const voices = [];
  let token;
  do {
    const query = new URLSearchParams({ voice_type: 'default', page_size: '100' });
    if (token) query.set('next_page_token', token);
    const page = await readJson(await elevenlabsRequest(`/v2/voices?${query}`, { signal }));
    if (!Array.isArray(page.voices)) throw new ElevenLabsAudioError('ElevenLabs 返回的声音库格式有误');
    voices.push(...page.voices.map(validateVoice));
    token = page.has_more ? page.next_page_token : null;
    if (page.has_more && !token) throw new ElevenLabsAudioError('ElevenLabs 返回的声音库分页有误');
  } while (token);
  return voices;
}
export async function createElevenLabsVoice({ displayName, sample, signal }) {
  const form = new FormData();
  form.set('name', displayName); form.append('files', sample, sample.name); form.set('remove_background_noise', 'false');
  const result = await readJson(await elevenlabsRequest('/v1/voices/add', { method: 'POST', body: form, signal }));
  validateVoiceId(result.voice_id);
  if (typeof result.requires_verification !== 'boolean') throw new ElevenLabsAudioError('ElevenLabs 返回的音色验证状态有误');
  return result;
}
export async function deleteElevenLabsVoice(voiceId, { signal } = {}) {
  validateVoiceId(voiceId);
  const response = await elevenlabsRequest(`/v1/voices/${encodeURIComponent(voiceId)}`, { method: 'DELETE', signal, requireEnabled: false });
  await response.body?.cancel();
}
