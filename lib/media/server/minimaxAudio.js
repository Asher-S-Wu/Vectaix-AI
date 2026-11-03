import { Agent } from 'undici';
import { getMediaConnection } from '@/lib/server/media/settings';
import { MINIMAX_AUDIO_MODEL, MINIMAX_VOICE_ID_PATTERN, parseMiniMaxSpeechInput } from '@/lib/media/shared/minimaxAudio';
import { readLimitedBytes } from './readLimitedBytes';

export class MiniMaxAudioError extends Error {
  constructor(message, { status = 502, code = 'MINIMAX_AUDIO_ERROR', requestId = '', upstreamRejected = false, upstreamMessage = '' } = {}) {
    super(message);
    this.name = 'MiniMaxAudioError';
    Object.assign(this, { status, code, requestId, upstreamRejected, upstreamMessage });
  }
}
export function minimaxErrorStatus(error) {
  if (error?.name === 'AbortError') return 499;
  const status = Number(error?.status ?? error?.statusCode);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}
export function minimaxPublicMessage(error, defaultMessage) {
  if (error?.name === 'AbortError') return '操作已取消';
  return error instanceof MiniMaxAudioError || minimaxErrorStatus(error) < 500 ? error.message : defaultMessage;
}
export async function resolveMiniMaxAudioConfig(options) {
  return getMediaConnection('minimaxAudio', options);
}

const BUSY = [429, 'MiniMax 当前请求较多，请稍后再试'];
const INVALID_KEY = [503, 'MiniMax 服务密钥无效'];
const NO_BALANCE = [503, 'MiniMax 服务账户余额不足'];
const NO_MODEL = [503, 'MiniMax 账户无法使用 Speech 2.8 HD 模型，请检查套餐'];
// Business errors arrive as HTTP 200 with base_resp.status_code; every listed code means the request was rejected.
const UPSTREAM_ERRORS = {
  1002: BUSY, 1039: BUSY, 1041: BUSY, 1045: BUSY, 2045: BUSY, 2046: BUSY, 2047: BUSY,
  1004: INVALID_KEY, 2049: INVALID_KEY,
  1008: NO_BALANCE, 2053: NO_BALANCE, 2067: NO_BALANCE,
  2022: NO_MODEL, 2061: NO_MODEL, 2068: NO_MODEL, 2069: NO_MODEL,
  1026: [400, '文字内容未通过 MiniMax 安全审核，请调整后再试'],
  1027: [400, '生成的语音未通过 MiniMax 安全审核，请调整文字后再试'],
  1040: [400, '声音样本未通过 MiniMax 安全审核，请更换录音'],
  1042: [400, '文字包含过多无法识别的字符，请检查后再试'],
  2013: [400, 'MiniMax 未接受本次参数，请检查文字和音色'],
  20132: [400, '声音样本或音色编号有误，请检查后再试'],
  2037: [400, '声音样本时长须在 10 秒到 5 分钟之间'],
  2038: [403, 'MiniMax 账户尚未完成实名认证，暂时无法复刻声音'],
  2039: [409, '音色编号重复，请重新提交'],
  2042: [404, '无权使用该 MiniMax 音色'],
  2043: [400, '该音色无法用于 Speech 2.8 HD 模型，请选择其他音色'],
  2051: [400, '声音样本未通过质量检测，请换一段清晰、没有明显噪音的录音'],
  2052: [409, 'MiniMax 账户的复刻音色数量已达上限，请删除闲置音色'],
  2054: [404, '该 MiniMax 音色不存在或已被删除'],
};
const responseError = message => new MiniMaxAudioError(message);
// The overall abort signal does not change Node's default 10-second connection timeout.
const minimaxAgent = new Agent({ connectTimeout: 30000 });

async function minimaxRequest(path, options) {
  try {
    return await sendMiniMaxRequest(path, options);
  } catch (error) {
    if (error?.cause?.code === 'UND_ERR_CONNECT_TIMEOUT') {
      throw new MiniMaxAudioError('连接 MiniMax 超时，请稍后再试', { status: 504, code: 'MINIMAX_CONNECT_TIMEOUT', upstreamRejected: true });
    }
    if (error?.name === 'TimeoutError' || ['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(error?.cause?.code)) {
      throw new MiniMaxAudioError('等待 MiniMax 响应超时，请稍后再试', { status: 504, code: 'MINIMAX_RESPONSE_TIMEOUT' });
    }
    throw error;
  }
}

async function sendMiniMaxRequest(path, { body, rawBody, form, signal, onRequestDispatched, requireEnabled = true, maxBytes = 2 * 1024 * 1024 } = {}) {
  signal?.throwIfAborted();
  const config = await resolveMiniMaxAudioConfig({ requireEnabled });
  const timeout = AbortSignal.timeout(240000);
  signal?.throwIfAborted();
  onRequestDispatched?.();
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, ...(form ? {} : { 'Content-Type': 'application/json' }) },
    body: form || rawBody || JSON.stringify(body),
    dispatcher: minimaxAgent,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout, redirect: 'error', cache: 'no-store',
  });
  const headerTraceId = response.headers.get('trace-id') || '';
  if (!response.ok) {
    await response.body?.cancel();
    const [status, message] = response.status === 401 ? INVALID_KEY : response.status === 429 ? BUSY : [response.status >= 500 ? 502 : 400, 'MiniMax 服务请求失败'];
    throw new MiniMaxAudioError(message, { status, code: `UPSTREAM_${response.status}`, requestId: headerTraceId, upstreamRejected: response.status < 500 });
  }
  const text = (await readLimitedBytes(response, maxBytes, { label: 'MiniMax', createError: responseError })).toString('utf8');
  let data;
  try { data = JSON.parse(text); } catch { throw new MiniMaxAudioError('MiniMax 返回的数据格式有误', { requestId: headerTraceId }); }
  const requestId = typeof data?.trace_id === 'string' && data.trace_id ? data.trace_id : headerTraceId;
  const code = data?.base_resp?.status_code;
  if (code !== 0) {
    const known = UPSTREAM_ERRORS[code];
    throw new MiniMaxAudioError(known ? known[1] : 'MiniMax 服务请求失败', {
      status: known ? known[0] : 502, code: `MINIMAX_${code}`, requestId, upstreamRejected: Boolean(known),
      upstreamMessage: typeof data?.base_resp?.status_msg === 'string' ? data.base_resp.status_msg : '',
    });
  }
  return { data, text, requestId };
}

export function buildMiniMaxSpeechPayload(input) {
  const parsed = parseMiniMaxSpeechInput(input);
  return {
    model: MINIMAX_AUDIO_MODEL, text: parsed.text, stream: false, output_format: 'hex',
    voice_setting: { voice_id: parsed.voiceId, speed: parsed.speed, vol: parsed.volume, pitch: parsed.pitch, ...(parsed.emotion === 'auto' ? {} : { emotion: parsed.emotion }) },
    audio_setting: { sample_rate: parsed.sampleRate, format: parsed.format, channel: 1, ...(parsed.format === 'mp3' ? { bitrate: parsed.bitrate } : {}) },
    language_boost: parsed.languageBoost,
    ...(parsed.textNormalization === 'off' ? {} : { text_normalization_mode: parsed.textNormalization }),
    ...(parsed.soundEffect === 'none' ? {} : { voice_modify: { sound_effects: parsed.soundEffect } }),
  };
}

export async function synthesizeMiniMaxSpeech(input, { signal, onRequestDispatched, onUpstreamComplete } = {}) {
  const parsed = parseMiniMaxSpeechInput(input);
  const { data, requestId } = await minimaxRequest('/v1/t2a_v2', { body: buildMiniMaxSpeechPayload(parsed), signal, onRequestDispatched, maxBytes: 250 * 1024 * 1024 });
  const hex = data.data?.audio;
  if (typeof hex !== 'string' || !hex || hex.length % 2 || !/^[0-9a-f]+$/i.test(hex)) throw new MiniMaxAudioError('MiniMax 返回的音频数据有误', { requestId });
  const audioBuffer = Buffer.from(hex, 'hex');
  onUpstreamComplete?.();
  const characters = data.extra_info?.usage_characters;
  // usage_voice_count only appears when a cloned voice is used for the first time and its fee applies.
  const voiceCount = data.extra_info?.usage_voice_count ?? 0;
  if (!Number.isSafeInteger(characters) || characters < 0 || !Number.isSafeInteger(voiceCount) || voiceCount < 0) throw new MiniMaxAudioError('MiniMax 返回的计费用量有误', { requestId });
  return { audioBuffer, mimeType: parsed.format === 'wav' ? 'audio/wav' : 'audio/mpeg', bytes: Buffer.byteLength(parsed.text, 'utf8'), characters, voiceCount, requestId };
}

function validateVoiceId(voiceId) {
  if (typeof voiceId !== 'string' || !MINIMAX_VOICE_ID_PATTERN.test(voiceId)) throw new MiniMaxAudioError('音色编号无效', { status: 400, upstreamRejected: true });
}
function validateVoice(voice) {
  if (!voice || typeof voice.voice_id !== 'string' || !MINIMAX_VOICE_ID_PATTERN.test(voice.voice_id)
    || (voice.voice_name != null && typeof voice.voice_name !== 'string')
    || (voice.description != null && (!Array.isArray(voice.description) || voice.description.some(item => typeof item !== 'string')))) {
    throw new MiniMaxAudioError('MiniMax 返回的音色信息有误');
  }
  return { ...voice, voice_id: voice.voice_id.trim() };
}

const VOICE_LANGUAGE_PREFIXES = {
  chinese: 'zh', cantonese: 'zh-yue', english: 'en', japanese: 'ja', korean: 'ko', spanish: 'es', portuguese: 'pt', french: 'fr',
  indonesian: 'id', german: 'de', russian: 'ru', italian: 'it', arabic: 'ar', turkish: 'tr', ukrainian: 'uk', dutch: 'nl',
  vietnamese: 'vi', thai: 'th', polish: 'pl', romanian: 'ro', greek: 'el', czech: 'cs', finnish: 'fi', hindi: 'hi',
};
export function minimaxVoiceLanguages(voiceId) {
  const language = VOICE_LANGUAGE_PREFIXES[voiceId.split(/[ _]/)[0].toLowerCase()];
  return language ? [language] : [];
}

export async function listMiniMaxVoices(voiceType, { signal } = {}) {
  const { data } = await minimaxRequest('/v1/get_voice', { body: { voice_type: voiceType }, signal, maxBytes: 8 * 1024 * 1024 });
  const list = data[voiceType === 'system' ? 'system_voice' : 'voice_cloning'];
  if (list === null || list === undefined) return [];
  if (!Array.isArray(list)) throw new MiniMaxAudioError('MiniMax 返回的声音库格式有误');
  return list.map(validateVoice);
}

export async function createMiniMaxVoice({ voiceId, sample, needNoiseReduction, needVolumeNormalization, signal }) {
  validateVoiceId(voiceId);
  const form = new FormData();
  form.set('purpose', 'voice_clone'); form.append('file', sample, sample.name);
  const upload = await minimaxRequest('/v1/files/upload', { form, signal });
  // file_id is an int64; read the digits from the raw JSON so large ids keep their precision.
  const fileId = upload.text.match(/"file_id"\s*:\s*(\d{1,20})\s*[,}]/)?.[1];
  if (!fileId) throw new MiniMaxAudioError('MiniMax 返回的文件编号有误', { requestId: upload.requestId });
  const options = JSON.stringify({ voice_id: voiceId, need_noise_reduction: needNoiseReduction, need_volume_normalization: needVolumeNormalization });
  const { data, requestId } = await minimaxRequest('/v1/voice_clone', { rawBody: `{"file_id":${fileId},${options.slice(1)}`, signal });
  const sensitive = data.input_sensitive;
  if (sensitive === true || (sensitive && typeof sensitive === 'object' && sensitive.type) || data.input_sensitive_type) {
    throw new MiniMaxAudioError('声音样本未通过 MiniMax 安全审核，请更换录音', { status: 400, requestId, upstreamRejected: true });
  }
  return { voiceId, requestId };
}

export async function deleteMiniMaxVoice(voiceId, { signal } = {}) {
  validateVoiceId(voiceId);
  try {
    await minimaxRequest('/v1/delete_voice', { body: { voice_type: 'voice_cloning', voice_id: voiceId }, signal, requireEnabled: false });
  } catch (error) {
    // MiniMax also reports an already deleted voice as 2013 with this specific detail.
    if (error?.code === 'MINIMAX_2054'
      || (error?.code === 'MINIMAX_2013' && error.upstreamMessage === 'invalid params, voice_id does not exist')) return;
    throw error;
  }
}
