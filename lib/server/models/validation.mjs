export const PROVIDER_PROTOCOLS = ['chat-completions', 'responses', 'anthropic', 'gemini'];
export function modelError(message, status = 400) { return Object.assign(new Error(message), { status,publicMessage:true }); }
function text(value, label, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw modelError(`${label}不能为空，且不能超过 ${max} 字`);
  return value.trim();
}
function bool(value, label) { if (typeof value !== 'boolean') throw modelError(`${label}必须是开关值`); return value; }
export function validateProvider(input) {
  if (!input || typeof input !== 'object') throw modelError('服务商配置无效');
  const id = text(input.id, '服务商标识', 100);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw modelError('服务商标识只能使用字母、数字、下划线和短横线');
  if (!PROVIDER_PROTOCOLS.includes(input.protocol)) throw modelError('请选择有效的接口协议');
  let url;
  try { url = new URL(input.baseUrl); } catch { throw modelError('服务商地址无效'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw modelError('服务商地址必须是没有账号、参数或锚点的 HTTPS 地址');
  return { id, name:text(input.name,'服务商名称'), baseUrl:url.href.replace(/\/$/,''), protocol:input.protocol, enabled:bool(input.enabled,'启用') };
}
export function validateModel(input) {
  if (!input || typeof input !== 'object') throw modelError('模型配置无效');
  const id = text(input.id,'模型标识');
  if (!/^[a-zA-Z0-9_./:-]+$/.test(id)) throw modelError('模型标识格式无效');
  const contextWindow = input.contextWindow;
  const maxOutputTokens = input.maxOutputTokens;
  if (!Number.isSafeInteger(contextWindow) || contextWindow < 512 || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens >= contextWindow) throw modelError('输出长度必须小于上下文长度，上下文至少为 512');
  if (!Number.isSafeInteger(input.sortOrder)) throw modelError('排序必须是整数');
  if (!Array.isArray(input.nativeInputs) || !input.nativeInputs.includes('text') || input.nativeInputs.some(v => !['text','image','audio','video'].includes(v))) throw modelError('输入能力必须包含文字');
  const pricing = {};
  for (const key of ['inputPerMillion','outputPerMillion','cachedInputPerMillion','cacheWritePerMillion']) {
    if (!Number.isFinite(input.pricing?.[key]) || input.pricing[key] < 0) throw modelError('模型价格必须是非负数字');
    pricing[key] = input.pricing[key];
  }
  if (input.pricing.longContextThreshold !== undefined) {
    if (!Number.isSafeInteger(input.pricing.longContextThreshold) || input.pricing.longContextThreshold < 1) throw modelError('长上下文价格阈值无效');
    pricing.longContextThreshold = input.pricing.longContextThreshold;
    for (const key of ['longInputMultiplier','longOutputMultiplier']) {
      if (!Number.isFinite(input.pricing[key]) || input.pricing[key] <= 0) throw modelError('长上下文价格倍率无效');
      pricing[key] = input.pricing[key];
    }
  }
  if (!['tokens','upstream-cost'].includes(input.billingMode)) throw modelError('计费方式无效');
  const options = input.requestOptions;
  if (!options || typeof options !== 'object' || Array.isArray(options) || JSON.stringify(options).length > 12000) throw modelError('请求参数必须是 JSON 对象且不超过 12000 字');
  const allowed = new Set(['reasoning','text','include','service_tier','enable_thinking','preserve_thinking','cache_control','thinking','generationConfig']);
  if (Object.keys(options).some(key => !allowed.has(key))) throw modelError('请求参数包含不支持的字段');
  if (input.isTranscriptionDefault && !input.nativeInputs.includes('audio')) throw modelError('默认转写模型必须支持音频输入');
  return { id, name:text(input.name,'模型名称'), providerId:text(input.providerId,'服务商标识'), upstreamModel:text(input.upstreamModel,'上游模型名称'), group:text(input.group,'分组'), enabled:bool(input.enabled,'启用'), isDefault:bool(input.isDefault,'默认模型'), isTranscriptionDefault:bool(input.isTranscriptionDefault ?? false,'默认转写模型'),sortOrder:input.sortOrder, contextWindow,maxOutputTokens,nativeInputs:[...new Set(input.nativeInputs)],supportsTools:bool(input.supportsTools,'工具调用'),supportsWebSearch:bool(input.supportsWebSearch,'联网搜索'),pricing,billingMode:input.billingMode,requestOptions:structuredClone(options) };
}
export function publicModel(model) {
  return Object.fromEntries(['id','name','providerId','group','enabled','isDefault','isTranscriptionDefault','sortOrder','contextWindow','maxOutputTokens','nativeInputs','supportsTools','supportsWebSearch','pricing','billingMode','protocol'].map(key => [key,model[key]]).concat([['provider',model.group]]));
}
export function publicProvider(provider) {
  return { id:provider.id,name:provider.name,baseUrl:provider.baseUrl,protocol:provider.protocol,enabled:provider.enabled,hasKey:Boolean(provider.encryptedKey) };
}
