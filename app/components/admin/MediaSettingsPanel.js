'use client';

import { useI18n } from "@/lib/client/i18n";

import { useEffect, useState } from 'react';
import { AdminField, AdminNotice, adminRequest } from './AdminUI';
import { IMAGE_MODELS, getImageModelConfig } from '@/lib/media/shared/models';
import { FISH_AUDIO_FORMATS, FISH_AUDIO_SAMPLE_RATES } from '@/lib/media/shared/fishAudio';

export default function MediaSettingsPanel() {
  const { t, locale, formatNumber } = useI18n();

  const [config, setConfig] = useState(null);
  const [keys, setKeys] = useState({ image: '', audio: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; adminRequest('/api/admin/media').then(data => { if (active) setConfig(data.config); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, []);
  const update = (section, field, value) => setConfig(current => ({ ...current, [section]: { ...current[section], [field]: value } }));
  const save = async event => { event.preventDefault(); setBusy(true); setError(''); setNotice(''); try {
    const body = Object.fromEntries(['image', 'audio'].map(section => { const { hasApiKey: _hasApiKey, ...values } = config[section]; return [section, { ...values, ...(keys[section] ? { apiKey: keys[section] } : {}) }]; }));
    const data = await adminRequest('/api/admin/media', { method: 'PUT', body }); setConfig(data.config); setKeys({ image: '', audio: '' }); setNotice(["媒体设置已保存，所有用户的花卷将使用这些服务。", "Media settings saved. Huajuan will use these services for all users."]);
  } catch (e) { setError(e.message); } finally { setBusy(false); } };
  return <><AdminNotice error={error} notice={notice} />{config ? <form onSubmit={save}>
    {['image', 'audio'].map(section => <section key={section} className="admin-section">
      <div className="admin-section-title flex items-center justify-between gap-3"><div><h2>{section === 'image' ? t("图片服务", "Image service") : t("语音服务", "Audio service")}</h2><p>{section === 'image' ? t("为花卷提供图片生成和编辑能力。", "Let Huajuan generate and edit images.") : t("为花卷提供语音合成与朗读能力。", "Let Huajuan generate speech and read text aloud.")}</p></div><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={config[section].enabled} onChange={event => update(section, 'enabled', event.target.checked)} />{t("启用", "Enable")}</label></div>
      <div className="admin-field-grid"><AdminField label={t("API 地址", "API URL")} type="url" value={config[section].baseUrl} onChange={event => update(section, 'baseUrl', event.target.value)} required={config[section].enabled} /><AdminField label="API Key" type="password" autoComplete="new-password" value={keys[section]} onChange={event => setKeys(current => ({ ...current, [section]: event.target.value }))} placeholder={config[section].hasApiKey ? t("已安全保存，留空保持", "Saved securely; leave blank to keep") : t("输入 API Key", "Enter an API key")} /></div>
      {section === 'image' ? <div className="admin-field-grid"><AdminField label={t("图片模型", "Image model")}><select value={config.image.model} onChange={event => update('image', 'model', event.target.value)}>{IMAGE_MODELS.map(model => <option key={model.id} value={model.id}>{model.name} · {model.id.endsWith('flare') ? t("速度", "Speed") : t("质量", "Quality")}</option>)}</select></AdminField><AdminField label={t("默认尺寸", "Default size")}><select value={config.image.size} onChange={event => update('image', 'size', event.target.value)}>{getImageModelConfig(config.image.model, locale).sizes.map(size => <option key={size.id} value={size.id}>{size.label}</option>)}</select></AdminField><AdminField label={t("默认张数", "Default image count")} type="number" min="1" max="4" step="1" value={config.image.count} onChange={event => update('image', 'count', Number(event.target.value))} /></div> : <div className="admin-field-grid"><AdminField label={t("默认音色 ID", "Default voice ID")} value={config.audio.voiceId} onChange={event => update('audio', 'voiceId', event.target.value)} hint={t("可以在语音工作区中创建与选择音色。", "Create and select voices in the audio workspace.")} /><AdminField label={t("音频格式", "Audio format")}><select value={config.audio.format} onChange={event => { update('audio', 'format', event.target.value); if (!FISH_AUDIO_SAMPLE_RATES[event.target.value].includes(config.audio.sampleRate)) update('audio', 'sampleRate', 44100); }}>{FISH_AUDIO_FORMATS.map(format => <option key={format} value={format}>{format.toUpperCase()}</option>)}</select></AdminField><AdminField label={t("语速", "Speed")} type="number" min="0.5" max="2" step="0.05" value={config.audio.speed} onChange={event => update('audio', 'speed', Number(event.target.value))} /><AdminField label={t("采样率", "Sample rate")}><select value={config.audio.sampleRate} onChange={event => update('audio', 'sampleRate', Number(event.target.value))}>{FISH_AUDIO_SAMPLE_RATES[config.audio.format].map(rate => <option key={rate} value={rate}>{formatNumber(rate)} Hz</option>)}</select></AdminField></div>}
    </section>)}
    <button className="admin-button primary mb-8" disabled={busy}>{busy ? t("正在保存…", "Saving…") : t("保存媒体设置", "Save media settings")}</button>
  </form> : <p className="py-8 text-sm text-zinc-500">{error ? t("请刷新页面重新加载媒体配置。", "Refresh the page to reload media settings.") : t("正在读取媒体配置…", "Loading media settings…")}</p>}</>;
}
