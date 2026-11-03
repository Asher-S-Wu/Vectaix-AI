import dbConnect from '@/lib/db';
import MediaSettings from '@/models/MediaSettings';
import { encryptSecret, decryptSecret } from '@/lib/server/security/secrets.mjs';
import { assertPublicUrl } from '@/lib/server/security/publicUrl.mjs';
import { IMAGE_MODEL, validateImageOptions } from '@/lib/media/shared/models';
import { ELEVENLABS_AUDIO_DEFAULTS, parseElevenLabsSpeechInput } from '@/lib/media/shared/elevenlabsAudio';
import { MINIMAX_AUDIO_DEFAULTS, parseMiniMaxSpeechInput } from '@/lib/media/shared/minimaxAudio';

export const DEFAULT_MEDIA_SETTINGS = {
  image: { enabled: false, baseUrl: 'https://www.micuapi.ai/v1/images', model: IMAGE_MODEL, size: '1024x1024', quality: 'low', count: 1 },
  audio: { ...ELEVENLABS_AUDIO_DEFAULTS },
  minimaxAudio: { ...MINIMAX_AUDIO_DEFAULTS },
};
// Each speech provider keeps its own settings section; audioProvider picks the one used for chat read-aloud and tasks.
export const AUDIO_PROVIDER_SECTIONS = Object.freeze({ elevenlabs: 'audio', minimax: 'minimaxAudio' });
const AUDIO_PROVIDERS = Object.freeze({
  audio: { provider: 'elevenlabs', label: 'ElevenLabs', parse: parseElevenLabsSpeechInput, sampleVoiceId: 'JBFqnCBsd6RMkjVDRZzb' },
  minimaxAudio: { provider: 'minimax', label: 'MiniMax', parse: parseMiniMaxSpeechInput, sampleVoiceId: 'male-qn-qingse', baseUrl: MINIMAX_AUDIO_DEFAULTS.baseUrl },
});
const fail = (message, status = 400) => Object.assign(new Error(message), { status, code: status === 503 ? 'SERVICE_NOT_CONFIGURED' : 'INVALID_MEDIA_SETTINGS' });
const publicSection = section => Object.fromEntries(Object.entries(section).filter(([key]) => key !== 'encryptedApiKey'));

async function readSettings() {
  await dbConnect();
  return MediaSettings.findById('media').lean();
}

export async function getMediaSettings() {
  const record = await readSettings();
  return { audioProvider: record?.audioProvider ?? 'elevenlabs', ...Object.fromEntries(Object.keys(DEFAULT_MEDIA_SETTINGS).map(kind => {
    const value = record?.[kind] || DEFAULT_MEDIA_SETTINGS[kind];
    return [kind, { ...publicSection(value), hasApiKey: Boolean(value.encryptedApiKey) }];
  })) };
}

export async function saveMediaSettings(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'audioProvider' && !Object.hasOwn(DEFAULT_MEDIA_SETTINGS, key))) throw fail('媒体配置格式无效');
  const previous = await readSettings();
  const update = {};
  if (Object.hasOwn(body, 'audioProvider')) {
    if (!Object.hasOwn(AUDIO_PROVIDER_SECTIONS, body.audioProvider)) throw fail('请选择有效的默认语音服务');
    update.audioProvider = body.audioProvider;
  }
  for (const kind of Object.keys(DEFAULT_MEDIA_SETTINGS)) {
    if (!Object.hasOwn(body, kind)) continue;
    const input = body[kind];
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('媒体配置格式无效');
    const allowed = new Set([...Object.keys(DEFAULT_MEDIA_SETTINGS[kind]), 'apiKey', 'clearApiKey', 'hasApiKey']);
    if (Object.keys(input).some(key => !allowed.has(key))) throw fail('媒体配置包含未知字段');
    const value = { ...(previous?.[kind] || DEFAULT_MEDIA_SETTINGS[kind]), ...Object.fromEntries(Object.entries(input).filter(([key]) => Object.hasOwn(DEFAULT_MEDIA_SETTINGS[kind], key))) };
    if (typeof value.enabled !== 'boolean') throw fail('请选择是否启用媒体服务');
    if (typeof value.baseUrl !== 'string' || value.baseUrl.length > 2048) throw fail('服务地址无效');
    try {
      const url = await assertPublicUrl(value.baseUrl, { protocols: ['https:'] });
      if (url.search || url.hash) throw new Error();
      value.baseUrl = url.href.replace(/\/+$/, '');
    } catch { throw fail('请填写完整的公开 HTTPS 服务地址'); }
    if (input.apiKey !== undefined && (typeof input.apiKey !== 'string' || input.apiKey.length > 8192 || /[\r\n]/.test(input.apiKey))) throw fail('密钥格式无效');
    if (previous?.[kind]?.encryptedApiKey && value.baseUrl !== previous[kind].baseUrl && !input.apiKey?.trim() && !input.clearApiKey) throw fail('切换服务地址时请重新填写密钥');
    if (input.clearApiKey === true) delete value.encryptedApiKey;
    if (input.apiKey?.trim()) value.encryptedApiKey = encryptSecret(input.apiKey.trim(), `media:${kind}`);
    if (kind === 'image') Object.assign(value, validateImageOptions(value));
    const audio = AUDIO_PROVIDERS[kind];
    if (audio) {
      if (value.provider !== audio.provider) throw fail(`请选择 ${audio.label} 语音服务`);
      if (audio.baseUrl && value.baseUrl !== audio.baseUrl) throw fail('MiniMax 只能使用国内版地址 https://api.minimax.cn');
      if (typeof value.voiceId !== 'string') throw fail('音色编号格式无效');
      const { text: _text, voiceId, ...options } = audio.parse({ ...value, voiceId: value.voiceId || audio.sampleVoiceId, text: '验证音色参数' });
      Object.assign(value, options, { voiceId: value.voiceId && voiceId });
    }
    if (value.enabled && !value.encryptedApiKey) throw fail('启用前请填写服务密钥');
    update[kind] = value;
  }
  if (!Object.keys(update).length) throw fail('请选择要保存的媒体配置');
  const initialSections = Object.fromEntries(Object.keys(DEFAULT_MEDIA_SETTINGS).filter(kind => !Object.hasOwn(update, kind)).map(kind => [kind, structuredClone(DEFAULT_MEDIA_SETTINGS[kind])]));
  await MediaSettings.updateOne({ _id: 'media' }, { $set: update, $setOnInsert: initialSections }, { upsert: true });
  return getMediaSettings();
}

export async function getMediaConnection(kind, { requireEnabled = true } = {}) {
  const record = await readSettings();
  const value = record?.[kind];
  const audio = AUDIO_PROVIDERS[kind];
  if (audio && value?.provider !== audio.provider) throw fail(`请管理员在后台配置 ${audio.label} 语音服务`, 503);
  if (!value?.encryptedApiKey || (requireEnabled && !value.enabled)) throw fail('请管理员在后台启用并配置媒体服务', 503);
  await assertPublicUrl(value.baseUrl, { protocols: ['https:'] });
  return { ...publicSection(value), apiKey: decryptSecret(value.encryptedApiKey, `media:${kind}`) };
}

function sharedAudio(record, provider) {
  const value = record?.[AUDIO_PROVIDER_SECTIONS[provider]];
  return value?.provider === provider && value.enabled && value.encryptedApiKey && value.voiceId ? value : null;
}

export async function getAgentMediaSettings() {
  const record = await readSettings();
  const audio = sharedAudio(record, record?.audioProvider ?? 'elevenlabs');
  const settings = {};
  for (const [kind, value] of [['image', record?.image?.enabled && record.image.encryptedApiKey ? record.image : null], ['audio', audio]]) {
    if (!value) continue;
    const { baseUrl: _url, enabled: _enabled, ...options } = publicSection(value);
    settings[kind] = options;
  }
  return settings;
}

export async function getSharedAudioVoice(provider) {
  return sharedAudio(await readSettings(), provider)?.voiceId ?? null;
}

export async function clearSharedVoice(provider, voiceId) {
  const kind = AUDIO_PROVIDER_SECTIONS[provider];
  await MediaSettings.updateOne({ _id: 'media', [`${kind}.voiceId`]: voiceId }, { $set: { [`${kind}.voiceId`]: '' } });
}
