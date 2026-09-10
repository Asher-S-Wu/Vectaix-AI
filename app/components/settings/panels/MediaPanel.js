"use client";
import { useState } from 'react';
import { apiJson } from '@/lib/client/apiClient';
import { SettingsFields } from '@/app/components/chat/ChatSettingsDialog';
import { mediaSettingsFields, parseMediaSettings } from '@/app/components/chat/mediaSettingsFields';
import { Section, ErrorNotice, usePanelData } from '../SettingsUI';

export default function MediaPanel() {
  const panel = usePanelData('/api/settings');
  const [notice, setNotice] = useState('');
  return <><ErrorNotice error={panel.error} />{notice && <p role="status" className="text-sm text-primary">{notice}</p>}<Section title="创作与朗读" description="对话创作和回复朗读使用这里选定的配音服务与音色，按实际用量消耗积分。">{panel.data && <SettingsFields fields={mediaSettingsFields(panel.data.settings.chatMediaSettings)} busy={panel.busy} onCancel={() => window.history.back()} onSubmit={values => panel.run(async () => { await apiJson('/api/settings', { method: 'PUT', body: { chatMediaSettings: parseMediaSettings(values) } }); setNotice('创作设置已保存'); })} />}</Section></>;
}
