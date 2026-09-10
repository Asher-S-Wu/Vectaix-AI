"use client";
import { useState } from 'react';
import Image from 'next/image';
import { apiJson } from '@/lib/client/apiClient';
import { uploadPrivateFile } from '@/lib/client/uploadFile';
import { parseSoul, formatSoul } from '@/lib/shared/preferences.mjs';
import { Section, Field, Action, ErrorNotice, usePanelData, inputClass, downloadText } from '../SettingsUI';

export default function AssistantPanel() {
  const panel = usePanelData('/api/settings');
  const [notice, setNotice] = useState('');
  const assistant = panel.data?.settings.assistant;
  return <><ErrorNotice error={panel.error} />{notice && <p role="status" className="text-sm text-primary">{notice}</p>}{assistant && <>
    <Section title="你的助手" description="为助手设定名称、表达习惯和长期工作要求。"><form key={JSON.stringify(assistant)} className="space-y-4" onSubmit={event => { event.preventDefault(); const value = Object.fromEntries(new FormData(event.currentTarget)); panel.run(async () => { panel.setData(await apiJson('/api/settings', { method: 'PUT', body: { assistant: value } })); setNotice('助手设置已保存'); }); }}><div className="grid gap-4 sm:grid-cols-2"><Field label="助手名称" name="name" required maxLength={100} defaultValue={assistant.name} /><Field label="回复语言"><select name="language" className={inputClass} defaultValue={assistant.language}><option value="zh">简体中文</option><option value="en">英语</option><option value="auto">跟随用户</option></select></Field></div><Field label="表达风格" name="style" defaultValue={assistant.style} placeholder="例如：直接、简洁，先给结论再说明理由" maxLength={1000} /><Field label="长期工作要求"><textarea name="instructions" className={inputClass} rows={9} maxLength={20000} defaultValue={assistant.instructions} /></Field><Action primary type="submit" disabled={panel.busy}>保存助手</Action></form>{assistant.avatarFileId&&<Image src={`/api/files/${encodeURIComponent(assistant.avatarFileId)}`} alt="助手头像" width={64} height={64} unoptimized className="h-16 w-16 rounded-2xl object-cover"/>}<Field label="助手头像"><input type="file" accept="image/*" className={inputClass} onChange={event => { const file = event.target.files[0]; if (file) panel.run(async () => { const uploaded = await uploadPrivateFile(file, { kind: 'avatar' }); panel.setData(await apiJson('/api/settings', { method: 'PUT', body: { assistant: { avatarFileId: uploaded.fileId } } })); }); }} /></Field></Section>
    <Section title="导入与导出" description="使用 SOUL.md 保存或迁移助手的个性设置。"><Field label="导入 SOUL.md"><input type="file" accept=".md" className={inputClass} onChange={event => { const file = event.target.files[0]; if (file) panel.run(async () => { const imported = parseSoul(await file.text()); imported.avatarFileId = null; panel.setData(await apiJson('/api/settings', { method: 'PUT', body: { assistant: imported } })); setNotice('助手设置已导入'); }); }} /></Field><Action onClick={() => downloadText('SOUL.md', formatSoul(assistant), 'text/markdown')}>导出 SOUL.md</Action></Section>
  </>}</>;
}
