import { createHash } from 'node:crypto';
import dbConnect from '@/lib/db';
import PlatformSettings from '@/models/PlatformSettings';
import { encryptSecret, decryptSecret } from '@/lib/server/security/secrets.mjs';
import { publicFetch } from '@/lib/server/integrations/network.mjs';
import { DEFAULT_MODEL_SETTINGS, MODEL_PROTOCOLS } from './config';

const SECRET_CONTEXT = 'platform:model';
export function modelError(message, status = 400) { return Object.assign(new Error(message), { status, publicMessage: true }); }

export function normalizeModelBaseUrl(value) {
  let url;
  try { url = new URL(String(value).trim()); } catch { throw modelError('请输入完整的模型服务地址'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw modelError('模型地址应为 HTTPS 地址，且没有账号、查询参数或片段');
  url.pathname = url.pathname.replace(/\/(chat\/completions|messages|responses|models)\/?$/, '').replace(/\/+$/, '') || '/v1';
  return url.toString().replace(/\/$/, '');
}

function validateProtocol(protocol) {
  if (!MODEL_PROTOCOLS.some(item => item.id === protocol)) throw modelError('请选择 Chat、Message 或 Response 协议');
  return protocol;
}

export function validateModelSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw modelError('模型设置格式无效');
  const baseUrl = normalizeModelBaseUrl(input.baseUrl);
  const protocol = validateProtocol(input.protocol);
  const modelId = String(input.modelId || '').trim();
  if (!/^[\w./:@+-]{1,200}$/.test(modelId)) throw modelError('请选择有效模型');
  const displayName = String(input.displayName || modelId).trim().slice(0, 100);
  const contextWindow = Number(input.contextWindow), maxOutputTokens = Number(input.maxOutputTokens);
  if (!Number.isSafeInteger(contextWindow) || contextWindow < 1024 || contextWindow > 10000000) throw modelError('上下文长度需为 1024 至 10000000 的整数');
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 256 || maxOutputTokens >= contextWindow) throw modelError('输出长度需至少 256，并小于上下文长度');
  if (typeof input.supportsTools !== 'boolean') throw modelError('请设置工具调用能力');
  if (!Array.isArray(input.nativeInputs) || !input.nativeInputs.includes('text') || input.nativeInputs.some(item => !['text', 'image'].includes(item))) throw modelError('模型输入类型请选择文字或图片');
  const pricing = {};
  for (const key of ['inputPerMillion', 'cachedInputPerMillion', 'outputPerMillion']) {
    const value = Number(input.pricing?.[key]);
    if (!Number.isFinite(value) || value < 0 || value > 100000) throw modelError('费率需为 0 至 100000 之间的美元金额');
    pricing[key] = value;
  }
  return { baseUrl, protocol, modelId, displayName, contextWindow, maxOutputTokens, nativeInputs: [...new Set(input.nativeInputs)], supportsTools: input.supportsTools, pricing };
}

async function readConfig() {
  await dbConnect();
  const settings = await PlatformSettings.findById('platform').lean();
  return settings?.modelConfig || null;
}

export function publicAdminConfig(config) {
  if (!config) return { ...structuredClone(DEFAULT_MODEL_SETTINGS), hasApiKey: false };
  const { encryptedApiKey, ...visible } = config;
  return { ...structuredClone(visible), hasApiKey: Boolean(encryptedApiKey) };
}

export async function getAdminModelSettings() {
  return { config: publicAdminConfig(await readConfig()), protocols: MODEL_PROTOCOLS };
}

export async function saveAdminModelSettings(input, userId) {
  const config = validateModelSettings(input);
  const previous = await readConfig();
  const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  if (apiKey.length > 8192 || /[\r\n]/.test(apiKey)) throw modelError('API Key 格式无效');
  if (apiKey) config.encryptedApiKey = encryptSecret(apiKey, SECRET_CONTEXT);
  else if (!input.clearApiKey && previous?.encryptedApiKey) {
    if (previous.baseUrl !== config.baseUrl || previous.protocol !== config.protocol) throw modelError('切换服务地址或协议时，请重新输入 API Key');
    config.encryptedApiKey = previous.encryptedApiKey;
  }
  await PlatformSettings.updateOne({ _id: 'platform' }, { $set: { modelConfig: config, updatedBy: userId } }, { upsert: true });
  return { config: publicAdminConfig(config), protocols: MODEL_PROTOCOLS };
}

export async function discoverModels(input, { fetchImpl = publicFetch } = {}) {
  const baseUrl = normalizeModelBaseUrl(input?.baseUrl), protocol = validateProtocol(input?.protocol);
  let apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  if (!apiKey) {
    const saved = await readConfig();
    if (!saved?.encryptedApiKey || saved.baseUrl !== baseUrl || saved.protocol !== protocol) throw modelError('请先输入此服务的 API Key');
    apiKey = decryptSecret(saved.encryptedApiKey, SECRET_CONTEXT);
  }
  if (apiKey.length > 8192 || /[\r\n]/.test(apiKey)) throw modelError('API Key 格式无效');
  const headers = protocol === 'messages'
    ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    : { Authorization: `Bearer ${apiKey}` };
  const models = new Map();
  let cursor;
  for (let page = 0; page < 50; page++) {
    const url = new URL(`${baseUrl}/models`);
    if (protocol === 'messages') { url.searchParams.set('limit', '1000'); if (cursor) url.searchParams.set('after_id', cursor); }
    let response;
    try { response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(20000), redirect: 'error' }); }
    catch { throw modelError('模型列表获取失败，请检查服务地址和网络', 502); }
    if (!response.ok) { await response.body?.cancel(); throw modelError(response.status === 401 || response.status === 403 ? 'API Key 验证失败，请检查后重试' : `模型服务返回 HTTP ${response.status}，请检查地址和协议`, 502); }
    let data;
    try { data = await response.json(); } catch { throw modelError('模型服务返回了无效的列表', 502); }
    if (!Array.isArray(data.data)) throw modelError('模型服务返回的列表格式无效', 502);
    for (const item of data.data) if (typeof item.id === 'string' && /^[\w./:@+-]{1,200}$/.test(item.id)) models.set(item.id, { id: item.id, name: String(item.display_name || item.id).slice(0, 200) });
    if (protocol !== 'messages' || !data.has_more) return { models: [...models.values()].sort((a, b) => a.id.localeCompare(b.id)) };
    if (typeof data.last_id !== 'string' || !data.last_id || data.last_id === cursor) throw modelError('模型列表分页信息无效', 502);
    cursor = data.last_id;
  }
  throw modelError('模型列表超过 50 页，请缩小服务提供的模型范围', 502);
}

function asModel(config) {
  const providerId = createHash('sha256').update(`${config.baseUrl}|${config.protocol}`).digest('hex').slice(0, 20);
  return {
    id: config.modelId, name: config.displayName, upstreamModel: config.modelId,
    providerId, provider: config.protocol, group: config.protocol, protocol: config.protocol,
    enabled: true, isDefault: true, sortOrder: 0, contextWindow: config.contextWindow,
    maxOutputTokens: config.maxOutputTokens, defaultOutputTokens: config.maxOutputTokens,
    nativeInputs: [...config.nativeInputs], supportsTools: config.supportsTools,
    supportsWebSearch: config.supportsTools, billingMode: 'tokens', pricing: { ...config.pricing }, requestOptions: {},
  };
}

export async function getPublicModels() {
  const config = await readConfig();
  if (!config?.modelId) return { models: [], defaultModelId: null };
  const { requestOptions, upstreamModel, ...model } = asModel(config);
  return { models: [model], defaultModelId: model.id };
}

export async function getManagedModel(id) {
  const config = await readConfig();
  if (!config?.modelId) throw modelError('请管理员在后台配置模型服务', 503);
  if (id && id !== config.modelId) throw modelError('此模型已停用，请使用管理员当前设置的模型', 400);
  return asModel(config);
}

export async function getModelConnection() {
  const config = await readConfig();
  if (!config?.modelId || !config.encryptedApiKey) throw modelError('请管理员在后台配置模型地址、模型和 API Key', 503);
  const model = asModel(config);
  return { model, provider: { id: model.providerId, baseUrl: config.baseUrl, protocol: config.protocol, apiKey: decryptSecret(config.encryptedApiKey, SECRET_CONTEXT) } };
}

export async function getManagedChatRates() {
  const config = await readConfig();
  return config?.modelId ? { [config.modelId]: { ...config.pricing, provider: config.protocol, currency: 'USD', billingMode: 'tokens' } } : {};
}
