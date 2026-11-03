'use client';

import { useI18n } from '@/lib/client/i18n';
import { useEffect, useState } from 'react';
import { AudioLines, ImagePlus } from 'lucide-react';
import { AdminConfigSection, AdminField, AdminNotice, adminRequest } from './AdminUI';
import { IMAGE_MODELS, getImageModelConfig } from '@/lib/media/shared/models';
import { ELEVENLABS_AUDIO_FORMATS, ELEVENLABS_AUDIO_SAMPLE_RATES, ELEVENLABS_AUDIO_MODEL_LABEL } from '@/lib/media/shared/elevenlabsAudio';
import {
  MINIMAX_AUDIO_BITRATES, MINIMAX_AUDIO_EMOTIONS, MINIMAX_AUDIO_FORMATS, MINIMAX_AUDIO_MODEL_LABEL, MINIMAX_AUDIO_SAMPLE_RATES,
  MINIMAX_LANGUAGE_BOOSTS, MINIMAX_SOUND_EFFECTS, MINIMAX_TEXT_NORMALIZATION_MODES,
} from '@/lib/media/shared/minimaxAudio';
import { useMiniMaxLabels } from '../media/audioProviders';

const sections = ['image', 'audio', 'minimaxAudio'];
const emptyKeys = () => ({ image: '', audio: '', minimaxAudio: '' });
const numberValue = value => value === '' ? '' : Number(value);

export default function MediaSettingsPanel() {
  const { t, locale, formatNumber } = useI18n();
  const minimaxLabels = useMiniMaxLabels();
  const [config, setConfig] = useState(null);
  const [keys, setKeys] = useState(emptyKeys);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    adminRequest('/api/admin/media').then(data => { if (active) setConfig(data.config); }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, []);
  const update = (section, field, value) => setConfig(current => ({ ...current, [section]: { ...current[section], [field]: value } }));
  async function save(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const body = { audioProvider: config.audioProvider, ...Object.fromEntries(sections.map(section => {
        const { hasApiKey: _hasApiKey, ...values } = config[section];
        return [section, { ...values, ...(keys[section] ? { apiKey: keys[section] } : {}) }];
      })) };
      const data = await adminRequest('/api/admin/media', { method: 'PUT', body });
      setConfig(data.config); setKeys(emptyKeys());
      setNotice(['媒体设置已保存，所有用户的花卷将使用这些服务。', 'Media settings saved. Huajuan will use these services for all users.']);
    } catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  const voiceField = section => <AdminField label={t('默认音色 ID', 'Default voice ID')} value={config[section].voiceId} onChange={event => update(section, 'voiceId', event.target.value)} hint={t('可以在语音工作区中创建与选择音色。', 'Create and select voices in the audio workspace.')} />;
  const select = (section, field, label, options, parse = value => value) => <AdminField label={label}><select value={config[section][field]} onChange={event => update(section, field, parse(event.target.value))}>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></AdminField>;
  function elevenlabsFields() {
    const value = config.audio;
    const rates = ELEVENLABS_AUDIO_SAMPLE_RATES;
    return <div className="admin-field-grid">
      {voiceField('audio')}
      <AdminField label={t('音频格式', 'Audio format')}><select value={value.format} onChange={event => {
        update('audio', 'format', event.target.value);
        if (!rates[event.target.value].includes(value.sampleRate)) update('audio', 'sampleRate', 44100);
      }}>{ELEVENLABS_AUDIO_FORMATS.map(format => <option key={format} value={format}>{format.toUpperCase()}</option>)}</select></AdminField>
      <AdminField label={t('语速', 'Speed')} type="number" min="0.7" max="1.2" step="0.05" value={value.speed} onChange={event => update('audio', 'speed', numberValue(event.target.value))} />
      {select('audio', 'sampleRate', t('采样率', 'Sample rate'), rates[value.format].map(rate => [rate, `${formatNumber(rate)} Hz`]), Number)}
      {['stability', 'similarityBoost', 'style'].map((field, index) => <AdminField key={field} label={[t('稳定度', 'Stability'), t('相似度', 'Similarity'), t('风格强度', 'Style intensity')][index]} type="number" min="0" max="1" step="0.05" value={value[field]} onChange={event => update('audio', field, numberValue(event.target.value))} />)}
      <AdminField label={t('说话人增强', 'Speaker boost')}><input type="checkbox" className="h-4 w-4 accent-primary" checked={value.useSpeakerBoost} onChange={event => update('audio', 'useSpeakerBoost', event.target.checked)} /></AdminField>
    </div>;
  }
  function minimaxFields() {
    const value = config.minimaxAudio;
    return <div className="admin-field-grid">
      {voiceField('minimaxAudio')}
      {select('minimaxAudio', 'format', t('音频格式', 'Audio format'), MINIMAX_AUDIO_FORMATS.map(format => [format, format.toUpperCase()]))}
      {select('minimaxAudio', 'sampleRate', t('采样率', 'Sample rate'), MINIMAX_AUDIO_SAMPLE_RATES.map(rate => [rate, `${formatNumber(rate)} Hz`]), Number)}
      {value.format === 'mp3' && select('minimaxAudio', 'bitrate', t('比特率', 'Bitrate'), MINIMAX_AUDIO_BITRATES.map(rate => [rate, `${formatNumber(rate / 1000)} kbps`]), Number)}
      <AdminField label={t('语速', 'Speed')} type="number" min="0.5" max="2" step="0.05" value={value.speed} onChange={event => update('minimaxAudio', 'speed', numberValue(event.target.value))} />
      <AdminField label={t('音量', 'Volume')} type="number" min="0.1" max="10" step="0.1" value={value.volume} onChange={event => update('minimaxAudio', 'volume', numberValue(event.target.value))} />
      <AdminField label={t('语调', 'Pitch')} type="number" min="-12" max="12" step="1" value={value.pitch} onChange={event => update('minimaxAudio', 'pitch', numberValue(event.target.value))} />
      {select('minimaxAudio', 'emotion', t('情绪', 'Emotion'), MINIMAX_AUDIO_EMOTIONS.map(emotion => [emotion, minimaxLabels.emotions[emotion]]))}
      {select('minimaxAudio', 'languageBoost', t('语言增强', 'Language boost'), Object.keys(MINIMAX_LANGUAGE_BOOSTS).map(language => [language, minimaxLabels.language(language)]))}
      {select('minimaxAudio', 'soundEffect', t('音效', 'Sound effect'), MINIMAX_SOUND_EFFECTS.map(effect => [effect, minimaxLabels.soundEffects[effect]]))}
      {select('minimaxAudio', 'textNormalization', t('数字与符号读法', 'Numbers and symbols'), MINIMAX_TEXT_NORMALIZATION_MODES.map(mode => [mode, minimaxLabels.textNormalization[mode]]))}
    </div>;
  }
  const details = {
    image: { title: t('图片服务', 'Image service'), description: t('图片生成与编辑，设置默认尺寸和张数。', 'Generate and edit images; set the default size and count.'), model: config && getImageModelConfig(config.image.model, locale).name, icon: ImagePlus },
    audio: { title: t('ElevenLabs 语音服务', 'ElevenLabs speech service'), description: t('语音合成、声音复刻与朗读，设置默认音色和语速。', 'Generate speech, clone voices, and read aloud; set the default voice and speed.'), model: ELEVENLABS_AUDIO_MODEL_LABEL, icon: AudioLines },
    minimaxAudio: { title: t('MiniMax 语音服务', 'MiniMax speech service'), description: t('国内版 Speech 2.8 HD，提供系统音色、声音复刻与朗读。声音复刻需要 MiniMax 账户先完成实名认证。', 'Speech 2.8 HD (China) with built-in voices, voice cloning, and read-aloud. Voice cloning requires a verified MiniMax account.'), model: MINIMAX_AUDIO_MODEL_LABEL, icon: AudioLines },
  };
  return <><AdminNotice error={error} notice={notice} />{config ? <form onSubmit={save}><fieldset disabled={busy} className="min-w-0">
    <div className="admin-field-grid mb-5">
      <AdminField label={t('聊天朗读与花卷配音使用', 'Service for chat read-aloud and Huajuan')} hint={t('所选服务需要启用，并填写默认音色。', 'The selected service must be enabled with a default voice.')}><select value={config.audioProvider} onChange={event => setConfig(current => ({ ...current, audioProvider: event.target.value }))}><option value="elevenlabs">ElevenLabs</option><option value="minimax">MiniMax</option></select></AdminField>
    </div>
    <div className="admin-config-groups">
    {sections.map(section => <AdminConfigSection key={section}
      title={details[section].title}
      description={details[section].description}
      summary={<><span className={`admin-config-status ${config[section].enabled ? 'enabled' : ''}`}>{config[section].enabled ? t('已启用', 'Enabled') : t('已停用', 'Disabled')}</span><span>{details[section].model}</span></>}
      icon={details[section].icon}>
      <label className="mb-5 flex w-fit items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={config[section].enabled} onChange={event => update(section, 'enabled', event.target.checked)} />{t('启用', 'Enable')}</label>
      <div className="admin-field-grid">
        <AdminField label={t('API 地址', 'API URL')} type="url" value={config[section].baseUrl} onChange={event => update(section, 'baseUrl', event.target.value)} required={config[section].enabled} readOnly={section === 'minimaxAudio'} hint={section === 'minimaxAudio' ? t('固定使用 MiniMax 国内版，API Key 在 platform.minimaxi.com 创建。', 'Uses the MiniMax China platform. Create the API key at platform.minimaxi.com.') : undefined} />
        <AdminField label="API Key" type="password" autoComplete="new-password" value={keys[section]} onChange={event => setKeys(current => ({ ...current, [section]: event.target.value }))} placeholder={config[section].hasApiKey ? t('已安全保存，留空保持', 'Saved securely; leave blank to keep') : t('输入 API Key', 'Enter an API key')} />
      </div>
      {section === 'image' ? <div className="admin-field-grid">
        <AdminField label={t('图片模型', 'Image model')}><select value={config.image.model} onChange={event => { const nextModel = event.target.value; update('image', 'model', nextModel); const sizes = getImageModelConfig(nextModel, locale).sizes; if (!sizes.some(size => size.id === config.image.size)) update('image', 'size', sizes[0].id); }}>{IMAGE_MODELS.map(model => <option key={model.id} value={model.id}>{model.name} · {model.id.endsWith('flare') ? t('速度', 'Speed') : t('质量', 'Quality')}</option>)}</select></AdminField>
        <AdminField label={t('默认尺寸', 'Default size')}><select value={config.image.size} onChange={event => update('image', 'size', event.target.value)}>{getImageModelConfig(config.image.model, locale).sizes.map(size => <option key={size.id} value={size.id}>{size.label}</option>)}</select></AdminField>
        <AdminField label={t('默认张数', 'Default image count')} type="number" min="1" max="4" step="1" value={config.image.count} onChange={event => update('image', 'count', numberValue(event.target.value))} />
      </div> : section === 'audio' ? elevenlabsFields() : minimaxFields()}
    </AdminConfigSection>)}
    </div>
    <div className="admin-form-actions"><button type="submit" className="admin-button primary" disabled={busy}>{busy ? t('正在保存…', 'Saving…') : t('保存媒体设置', 'Save media settings')}</button></div>
  </fieldset></form> : error ? <button type="button" className="admin-button" onClick={() => window.location.reload()}>{t('重新加载', 'Reload')}</button> : <p role="status" className="py-8 text-sm text-zinc-500">{t('正在读取媒体配置…', 'Loading media settings…')}</p>}</>;
}
