'use client';

import { useI18n } from "@/lib/client/i18n";

import { useEffect, useRef, useState } from 'react';
import { Cable, Check, Coins, Cpu, Download, LoaderCircle, Network } from 'lucide-react';
import { AdminConfigSection, AdminField, AdminNotice, adminRequest } from './AdminUI';

const protocols = [
  { id: 'chat', title: 'Chat', detail: 'Chat Completions', path: '/chat/completions' },
  { id: 'messages', title: 'Message', detail: 'Anthropic Messages', path: '/messages' },
  { id: 'responses', title: 'Response', detail: 'Responses', path: '/responses' },
];

export default function ModelsPanel() {
  const { t, formatNumber } = useI18n();

  const [config, setConfig] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const [models, setModels] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const discoveryRequest = useRef(null);
  useEffect(() => { let active = true; adminRequest('/api/admin/models').then(data => { if (active) setConfig(data.config); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, []);
  const baseUrl = config?.baseUrl, protocol = config?.protocol, hasApiKey = config?.hasApiKey;
  useEffect(() => {
    discoveryRequest.current?.abort();
    let url;
    try { url = new URL(baseUrl); } catch { return; }
    if (clearApiKey || url.protocol !== 'https:' || (!apiKey.trim() && !hasApiKey)) return;
    const controller = new AbortController();
    discoveryRequest.current = controller;
    const timer = setTimeout(async () => {
      if (controller.signal.aborted) return;
      setBusy('discover'); setError('');
      try {
        const result = await adminRequest('/api/admin/models/discover', { method: 'POST', body: { baseUrl, protocol, ...(apiKey ? { apiKey } : {}) }, signal: controller.signal });
        if (!controller.signal.aborted) { setModels(result.models); setNotice(result.models.length ? ['已自动获取 {count} 个模型。', 'Loaded {count} models automatically.', { count: result.models.length }] : ["服务返回了空模型列表，请检查服务地址与密钥权限。", "The service returned an empty model list. Check the API URL and key permissions."]); }
      } catch (e) { if (!controller.signal.aborted) setError(e.message); }
      finally { if (!controller.signal.aborted) setBusy(''); }
    }, 800);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [baseUrl, protocol, hasApiKey, apiKey, clearApiKey]);
  const update = (key, value) => { setNotice(''); if (['baseUrl', 'protocol'].includes(key)) { discoveryRequest.current?.abort(); setBusy(''); } setConfig(current => ({ ...current, [key]: value })); };
  const run = async (name, action) => { setBusy(name); setError(''); setNotice(''); try { await action(); } catch (e) { setError(e.message); } finally { setBusy(''); } };
  const discover = () => run('discover', async () => {
    discoveryRequest.current?.abort();
    const controller = new AbortController(); discoveryRequest.current = controller;
    const result = await adminRequest('/api/admin/models/discover', { method: 'POST', body: { baseUrl: config.baseUrl, protocol: config.protocol, ...(apiKey ? { apiKey } : {}) }, signal: controller.signal });
    if (controller.signal.aborted) return;
    setModels(result.models); setNotice(result.models.length ? ['已获取 {count} 个模型，请选择本平台使用的模型。', 'Loaded {count} models. Choose one for this platform.', { count: result.models.length }] : ["服务返回了空模型列表，请检查服务地址与密钥权限。", "The service returned an empty model list. Check the API URL and key permissions."]);
  });
  const save = event => { event.preventDefault(); discoveryRequest.current?.abort(); run('save', async () => {
    const { hasApiKey: _hasApiKey, ...values } = config;
    const result = await adminRequest('/api/admin/models', { method: 'PUT', body: { ...values, clearApiKey, ...(apiKey ? { apiKey } : {}) } });
    setConfig(result.config); setApiKey(''); setClearApiKey(false); setNotice(result.config.hasApiKey ? ["模型服务已保存，所有用户的新任务将使用此配置。", "Model settings saved. They will apply to new tasks for all users."] : ["模型配置已保存。填写 API Key 并保存后，用户即可开始对话。", "Model settings saved. Add and save an API key to enable chats."]);
  }); };
  return <>
    <header className="admin-page-heading"><h1>{t("模型服务", "Model services")}</h1><p>{t("统一设置模型与连接方式。保存后，对所有用户的新任务生效。", "Choose a model and connection. Saved settings apply to new tasks for all users.")}</p></header>
    <AdminNotice error={error} notice={notice} />
    {!config ? (error ? <button type="button" className="admin-button" onClick={() => window.location.reload()}>{t("重新加载", "Reload")}</button> : <p role="status" className="py-10 text-sm text-zinc-500">{t("正在读取模型配置…", "Loading model settings…")}</p>) : <form onSubmit={save} className="admin-form"><fieldset disabled={busy === 'save'} className="min-w-0">
      <div className="admin-config-groups">
      <AdminConfigSection title={t("连接协议", "API protocol")} description={t("选择服务商提供的接口格式。", "Choose the API format provided by your service.")} summary={protocols.find(item => item.id === config.protocol)?.detail} icon={Network}>
        <fieldset className="protocol-options"><legend className="sr-only">{t("连接协议", "API protocol")}</legend>{protocols.map(item => <label key={item.id} className={`protocol-option ${config.protocol === item.id ? 'selected' : ''}`}><input type="radio" name="protocol" checked={config.protocol === item.id} onChange={() => { update('protocol', item.id); setModels([]); }} /><span className="flex items-center justify-between"><strong>{item.title}</strong>{config.protocol === item.id && <Check size={17} />}</span><span>{item.detail}</span><small>{item.path}</small></label>)}</fieldset>
      </AdminConfigSection>
      <AdminConfigSection title={t("服务连接", "Connection")} description={t("密钥加密保存在服务器。", "Keys are encrypted and stored on the server.")} summary={config.baseUrl || t("填写地址与密钥", "Add an API URL and key")} icon={Cable} defaultOpen={!config.hasApiKey}>
        <div className="admin-field-grid">
        <AdminField label={t("API 地址", "API URL")} hint={t("填写服务商的 API 基础地址或完整接口地址。", "Enter the provider’s API base URL or full endpoint URL.")} type="url" value={config.baseUrl} placeholder="https://api.example.com/v1" required onChange={event => { update('baseUrl', event.target.value); setModels([]); }} />
        <AdminField label="API Key" hint={config.hasApiKey ? t("已保存密钥。留空保持现有密钥。", "A key is saved. Leave this blank to keep it.") : t("输入具有模型调用权限的密钥。", "Enter a key with permission to use the model.")} type="password" autoComplete="new-password" value={apiKey} disabled={clearApiKey} placeholder={config.hasApiKey ? t("已安全保存", "Saved securely") : t("输入 API Key", "Enter an API key")} onChange={event => { discoveryRequest.current?.abort(); setBusy(''); setApiKey(event.target.value); }} />
      </div>{!config.hasApiKey && <p className="mb-4 text-sm text-amber-700 dark:text-amber-400">{t("尚未配置 API Key，当前模型服务未启用。", "No API key is saved. The model service is inactive.")}</p>}{config.hasApiKey && <label className="mb-4 flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={clearApiKey} onChange={event => { discoveryRequest.current?.abort(); setBusy(''); setClearApiKey(event.target.checked); setApiKey(''); setNotice(''); }} />{t("保存时删除密钥并停用模型服务", "Delete the key and disable model service on save")}</label>}<button type="button" className="admin-button" disabled={Boolean(busy) || clearApiKey || !config.baseUrl} onClick={discover}>{busy === 'discover' ? <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" /> : <Download size={16} />}{busy === 'discover' ? t("正在获取模型…", "Loading models…") : t("获取模型列表", "Load models")}</button>
      </AdminConfigSection>
      <AdminConfigSection title={t("使用的模型", "Active model")} description={t("设置模型、上下文长度与工具能力。", "Set the model, context window, and tool capabilities.")} summary={config.modelId || t("选择一个模型", "Choose a model")} icon={Cpu} defaultOpen={config.hasApiKey}>
        <div className="admin-field-grid">
        <AdminField label={t("模型", "Model")}>{models.length ? <select required value={config.modelId} onChange={event => update('modelId', event.target.value)}><option value="">{t("选择模型", "Choose a model")}</option>{!models.some(item => item.id === config.modelId) && config.modelId && <option value={config.modelId}>{config.modelId}</option>}{models.map(item => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select> : <input value={config.modelId} onChange={event => update('modelId', event.target.value)} required placeholder={t("先获取列表，也可填写模型 ID", "Load the list or enter a model ID")} />}</AdminField>
        <AdminField label={t("显示名称", "Display name")} value={config.displayName} required onChange={event => update('displayName', event.target.value)} placeholder={t("花卷助手", "Huajuan assistant")} />
        <AdminField label={t("上下文长度", "Context window")} type="number" min="1024" step="1" value={config.contextWindow} required onChange={event => update('contextWindow', (event.target.value === '' ? '' : Number(event.target.value)))} />
        <AdminField label={t("单次最大输出", "Maximum output tokens")} type="number" min="256" max={config.contextWindow - 1} step="1" value={config.maxOutputTokens} required onChange={event => update('maxOutputTokens', (event.target.value === '' ? '' : Number(event.target.value)))} />
      </div><div className="flex flex-wrap gap-5 text-sm"><label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-primary" checked={config.supportsTools} onChange={event => update('supportsTools', event.target.checked)} />{t("允许调用工具", "Allow tool use")}</label><label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-primary" checked={config.nativeInputs.includes('image')} onChange={event => update('nativeInputs', event.target.checked ? ['text', 'image'] : ['text'])} />{t("模型可理解图片", "Model can understand images")}</label></div>
      </AdminConfigSection>
      <AdminConfigSection title={t("用量计价", "Usage pricing")} description={t("每百万 Token 的美元价格，用于平台用量统计。", "Prices in USD per million tokens for platform usage costs.")} summary={t("输入 ${input} / 输出 ${output}", "Input ${input} / output ${output}", { input: config.pricing.inputPerMillion === '' ? '—' : formatNumber(config.pricing.inputPerMillion, { maximumFractionDigits: 6 }), output: config.pricing.outputPerMillion === '' ? '—' : formatNumber(config.pricing.outputPerMillion, { maximumFractionDigits: 6 }) })} icon={Coins}>
        <div className="admin-field-grid three">{[['inputPerMillion', t("输入", "Input")], ['cachedInputPerMillion', t("缓存输入", "Cached input")], ['outputPerMillion', t("输出", "Output")]].map(([key, label]) => <AdminField key={key} label={label} type="number" min="0" step="any" value={config.pricing[key]} required onChange={event => update('pricing', { ...config.pricing, [key]: (event.target.value === '' ? '' : Number(event.target.value)) })} />)}</div>
      </AdminConfigSection>
      </div>
      <div className="admin-form-actions"><button type="submit" disabled={Boolean(busy)} className="admin-button primary">{busy === 'save' ? t("正在保存…", "Saving…") : t("保存模型设置", "Save model settings")}</button><span className="text-xs text-zinc-500">{t("设置对全平台生效", "Applies to all users")}</span></div>
    </fieldset></form>}
  </>;
}
