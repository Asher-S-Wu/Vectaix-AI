"use client";

import { useState } from 'react';
import Image from 'next/image';
import SystemPromptModal from '../SystemPromptModal';
import { apiJson } from '@/lib/client/apiClient';
import { uploadPrivateFile } from '@/lib/client/uploadFile';
import { useThemeMode } from '@/lib/client/hooks/useThemeMode';
import { UI_THEME_MODE_KEY, UI_FONT_SIZE_KEY, UI_COMPLETION_SOUND_VOLUME_KEY } from '@/lib/shared/storageKeys';
import { Section, Field, Action, ErrorNotice, usePanelData, inputClass } from '../SettingsUI';

export default function GeneralPanel({ user }) {
  const panel = usePanelData('/api/settings');
  const [notice, setNotice] = useState('');
  const [templatesOpen,setTemplatesOpen]=useState(false);
  const settings = panel.data?.settings;
  useThemeMode(settings?.appearance.themeMode || 'system');
  const save = body => panel.run(async () => { const result = await apiJson('/api/settings', { method: 'PUT', body }); panel.setData(result); setNotice('已保存'); });
  const submit = (event, endpoint) => { event.preventDefault(); const form = event.currentTarget; const body = Object.fromEntries(new FormData(form)); panel.run(async () => { await apiJson(endpoint, { method: 'POST', body }); form.reset(); setNotice('账号资料已更新'); }); };
  const updatePrompts=async(method,body)=>{const result=await apiJson('/api/settings',{method,body});panel.setData(result);return result.settings.systemPrompts;};
  return <><ErrorNotice error={panel.error} />{notice && <p role="status" className="text-sm text-primary">{notice}</p>}{!settings ? <p className="text-sm text-zinc-500">正在加载设置…</p> : <>
    <Section title="个人资料" description="设置你在 Vectaix 中使用的头像和昵称。"><form className="space-y-4" onSubmit={event => { event.preventDefault(); save({ nickname: new FormData(event.currentTarget).get('nickname') }); }}>{settings.avatar&&<Image src={settings.avatar} alt="我的头像" width={64} height={64} unoptimized className="h-16 w-16 rounded-2xl object-cover"/>}<Field label="头像"><input type="file" accept="image/*" className={inputClass} disabled={panel.busy} onChange={event => { const file = event.target.files[0]; if (file) panel.run(async () => { const result = await uploadPrivateFile(file, { kind: 'avatar' }); panel.setData(await apiJson('/api/settings', { method: 'PUT', body: { avatarFileId: result.fileId } })); setNotice('头像已更新'); }); }} /></Field><Field name="nickname" label="昵称" defaultValue={settings.nickname} maxLength={50} /><Action type="submit" primary disabled={panel.busy}>保存资料</Action></form></Section>
    <Section title="外观与提示音"><form className="space-y-4" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); const appearance = { themeMode: form.get('themeMode'), fontSize: form.get('fontSize'), completionSoundVolume: Number(form.get('completionSoundVolume')) }; save({ appearance }); window.localStorage.setItem(UI_THEME_MODE_KEY, appearance.themeMode); window.localStorage.setItem(UI_FONT_SIZE_KEY, appearance.fontSize); window.localStorage.setItem(UI_COMPLETION_SOUND_VOLUME_KEY, String(appearance.completionSoundVolume)); }}><div className="grid gap-4 sm:grid-cols-2"><Field label="主题"><select className={inputClass} name="themeMode" defaultValue={settings.appearance.themeMode}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></Field><Field label="文字大小"><select className={inputClass} name="fontSize" defaultValue={settings.appearance.fontSize}><option value="small">小</option><option value="medium">标准</option><option value="large">大</option></select></Field></div><Field label="完成提示音音量" type="number" name="completionSoundVolume" min={0} max={100} defaultValue={settings.appearance.completionSoundVolume} hint="设为 0 可关闭提示音。" /><Action type="submit" primary disabled={panel.busy}>保存外观</Action></form></Section>
    <Section title="对话指令" description="设置每次对话遵循的工作要求。当前消息中的明确要求优先。"><form className="space-y-4" onSubmit={event => { event.preventDefault(); save({ chatSystemPrompt: new FormData(event.currentTarget).get('prompt') }); }}><textarea key={settings.chatSystemPrompt} name="prompt" aria-label="对话指令" className={inputClass} rows={6} maxLength={10000} defaultValue={settings.chatSystemPrompt} /><div className="flex flex-wrap gap-3"><Action type="submit" primary disabled={panel.busy}>保存指令</Action><Action onClick={()=>setTemplatesOpen(true)}>管理指令模板</Action></div></form></Section>
    <SystemPromptModal open={templatesOpen} onClose={()=>setTemplatesOpen(false)} chatSystemPrompt={settings.chatSystemPrompt} systemPrompts={settings.systemPrompts} onChatSystemPromptSave={chatSystemPrompt=>updatePrompts('PUT',{chatSystemPrompt})} addSystemPrompt={(name,content)=>updatePrompts('POST',{name,content})} updateSystemPrompt={(promptId,name,content)=>updatePrompts('PATCH',{promptId,name,content})} deleteSystemPrompt={promptId=>updatePrompts('DELETE',{promptId})}/>
    {!user.isAdmin && <Section title="更改邮箱"><form className="space-y-4" onSubmit={event => submit(event, '/api/auth/change-email')}><Field name="newEmail" label="新邮箱" type="email" required /><Field name="password" label="当前密码" type="password" autoComplete="current-password" required /><Action type="submit" disabled={panel.busy}>更改邮箱</Action></form></Section>}
    <Section title="更改密码"><form className="space-y-4" onSubmit={event => submit(event, '/api/auth/change-password')}><Field name="oldPassword" label="当前密码" type="password" autoComplete="current-password" required /><Field name="newPassword" label="新密码" type="password" autoComplete="new-password" required /><Field name="confirmNewPassword" label="再次输入新密码" type="password" autoComplete="new-password" required /><Action type="submit" disabled={panel.busy}>更改密码</Action></form></Section>
  </>}</>;
}
