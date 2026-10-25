"use client";
import { useI18n } from '@/lib/client/i18n';
import Select from '@/app/components/common/Select';
import { useState } from 'react';
import Image from 'next/image';
import { apiJson } from '@/lib/client/apiClient';
import { uploadPrivateFile } from '@/lib/client/uploadFile';
import { parseSoul, formatSoul } from '@/lib/shared/preferences.mjs';
import { Section, Field, FileInput, Action, ErrorNotice, usePanelData, inputClass, downloadText } from '../SettingsUI';

export default function AssistantPanel() {
  const { t } = useI18n();

  const panel = usePanelData('/api/settings');
  const [notice, setNotice] = useState('');
  const assistant = panel.data?.settings.assistant;
  return <><ErrorNotice error={panel.error} />{notice && <p role="status" className="text-sm text-primary">{t(...notice)}</p>}{assistant && <>
    <Section title={t("你的助手", "Your assistant")} description={t("为助手设定名称、表达习惯和长期工作要求。", "Choose your assistant’s name, writing style, and ongoing instructions.")}><form key={JSON.stringify(assistant)} className="space-y-4" onSubmit={event => { event.preventDefault(); const value = Object.fromEntries(new FormData(event.currentTarget)); panel.run(async () => { panel.setData(await apiJson('/api/settings', { method: 'PUT', body: { assistant: value } })); setNotice(["助手设置已保存", "Assistant settings saved"]); }); }}><div className="grid gap-4 sm:grid-cols-2"><Field label={t("助手名称", "Assistant name")} name="name" required maxLength={100} defaultValue={assistant.name} /><Field label={t("回复语言", "Reply language")}><Select name="language" className={inputClass} defaultValue={assistant.language} options={[{
  id: "zh",
  label: t("简体中文", "Simplified Chinese")
}, {
  id: "en",
  label: t("英语", "English")
}, {
  id: "auto",
  label: t("跟随用户", "Match your language")
}]} /></Field></div><Field label={t("表达风格", "Writing style")} name="style" defaultValue={assistant.style} placeholder={t("例如：直接、简洁，先给结论再说明理由", "For example: Be concise and direct. Give the answer first, then explain why.")} maxLength={1000} /><Field label={t("长期工作要求", "Ongoing instructions")}><textarea name="instructions" className={inputClass} rows={9} maxLength={20000} defaultValue={assistant.instructions} /></Field><Action primary type="submit" disabled={panel.busy}>{t("保存助手", "Save assistant")}</Action></form>{assistant.avatarFileId&&<Image src={`/api/files/${encodeURIComponent(assistant.avatarFileId)}`} alt={t("助手头像", "Assistant avatar")} width={64} height={64} unoptimized className="h-16 w-16 rounded-2xl object-cover"/>}<Field label={t("助手头像", "Assistant avatar")}><FileInput type="file" accept="image/*" className={inputClass} onChange={event => { const file = event.target.files[0]; if (file) panel.run(async () => { const uploaded = await uploadPrivateFile(file, { kind: 'avatar' }); panel.setData(await apiJson('/api/settings', { method: 'PUT', body: { assistant: { avatarFileId: uploaded.fileId } } })); }); }} /></Field></Section>
    <Section title={t("导入与导出", "Import and export")} description={t("使用 SOUL.md 保存或迁移助手的个性设置。", "Save or transfer your assistant’s preferences with a SOUL.md file.")}><Field label={t("导入 SOUL.md", "Import SOUL.md")}><FileInput type="file" accept=".md" className={inputClass} onChange={event => { const file = event.target.files[0]; if (file) panel.run(async () => { const imported = parseSoul(await file.text()); imported.avatarFileId = null; panel.setData(await apiJson('/api/settings', { method: 'PUT', body: { assistant: imported } })); setNotice(["助手设置已导入", "Assistant settings imported"]); }); }} /></Field><Action onClick={() => downloadText('SOUL.md', formatSoul(assistant), 'text/markdown')}>{t("导出 SOUL.md", "Export SOUL.md")}</Action></Section>
  </>}</>;
}
