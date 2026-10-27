import dbConnect from '@/lib/db';
import MediaSettings from '@/models/MediaSettings';
import { encryptSecret, decryptSecret } from '@/lib/server/security/secrets.mjs';
import { assertPublicUrl } from '@/lib/server/security/publicUrl.mjs';
import { IMAGE_MODEL, validateImageOptions } from '@/lib/media/shared/models';
import { ELEVENLABS_AUDIO_DEFAULTS, parseElevenLabsSpeechInput } from '@/lib/media/shared/elevenlabsAudio';

export const DEFAULT_MEDIA_SETTINGS = {
  image: { enabled: false, baseUrl: 'https://www.micuapi.ai/v1/images', model: IMAGE_MODEL, size: '1024x1024', quality: 'low', count: 1 },
  audio: { ...ELEVENLABS_AUDIO_DEFAULTS },
};
const fail = (message, status = 400) => Object.assign(new Error(message), { status, code: status === 503 ? 'SERVICE_NOT_CONFIGURED' : 'INVALID_MEDIA_SETTINGS' });
const publicSection = section => Object.fromEntries(Object.entries(section).filter(([key]) => key !== 'encryptedApiKey'));

async function readSettings() {
  await dbConnect();
  return MediaSettings.findById('media').lean();
}

export async function getMediaSettings() {
  const record = await readSettings();
  return Object.fromEntries(Object.keys(DEFAULT_MEDIA_SETTINGS).map(kind => {
    const value = record?.[kind] || DEFAULT_MEDIA_SETTINGS[kind];
    return [kind, { ...publicSection(value), hasApiKey: Boolean(value.encryptedApiKey) }];
  }));
}

export async function saveMediaSettings(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !Object.hasOwn(DEFAULT_MEDIA_SETTINGS, key))) throw fail('媒体配置格式无效');
  const previous = await readSettings();
  const update = {};
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
    if (kind === 'audio') {
      if (value.provider !== 'elevenlabs') throw fail('请选择 ElevenLabs 语音服务');
      if (typeof value.voiceId !== 'string') throw fail('音色编号格式无效');
      value.voiceId = value.voiceId.trim();
      const { text: _text, voiceId: _voiceId, ...options } = parseElevenLabsSpeechInput({ ...value, voiceId: value.voiceId || 'JBFqnCBsd6RMkjVDRZzb', text: '验证音色参数' });
      Object.assign(value, options);
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
  if (kind === 'audio' && value?.provider !== 'elevenlabs') throw fail('请管理员在后台配置 ElevenLabs 语音服务', 503);
  if (!value?.encryptedApiKey || (requireEnabled && !value.enabled)) throw fail('请管理员在后台启用并配置媒体服务', 503);
  await assertPublicUrl(value.baseUrl, { protocols: ['https:'] });
  return { ...publicSection(value), apiKey: decryptSecret(value.encryptedApiKey, `media:${kind}`) };
}

export async function getAgentMediaSettings() {
  const record = await readSettings();
  return Object.fromEntries(['image', 'audio'].filter(kind => record?.[kind]?.enabled && record[kind].encryptedApiKey && (kind === 'image' || (record[kind].provider === 'elevenlabs' && record[kind].voiceId))).map(kind => {
    const { baseUrl: _url, enabled: _enabled, ...settings } = publicSection(record[kind]);
    return [kind, settings];
  }));
}

export async function getSharedAudioVoice() {
  const record = await readSettings();
  const value = record?.audio;
  return value?.provider === 'elevenlabs' && value.enabled && value.encryptedApiKey && value.voiceId ? value.voiceId : null;
}

export async function clearSharedVoice(voiceId) {
  await MediaSettings.updateOne({ _id: 'media', 'audio.voiceId': voiceId }, { $set: { 'audio.voiceId': '' } });
}
