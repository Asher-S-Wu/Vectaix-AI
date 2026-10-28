"use client";

import { useI18n } from '@/lib/client/i18n';
import Select from '@/app/components/common/Select';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import SystemPromptModal from '../SystemPromptModal';
import { apiJson } from '@/lib/client/apiClient';
import { uploadPrivateFile } from '@/lib/client/uploadFile';
import { useThemePreference } from '@/lib/client/theme';
import { UI_FONT_SIZE_KEY, UI_COMPLETION_SOUND_VOLUME_KEY } from '@/lib/shared/storageKeys';
import { Section, Field, FileInput, Action, ErrorNotice, PanelState, usePanelData, inputClass } from '../SettingsUI';

export default function GeneralPanel({ user, initialSettings }) {
  const { t, locale, setLocale } = useI18n();
  const { themeMode, setThemeMode } = useThemePreference();

  const router = useRouter();
  const panel = usePanelData('/api/settings', initialSettings ? { settings: initialSettings } : null);
  const [notice, setNotice] = useState('');
  const [templatesOpen,setTemplatesOpen]=useState(false);
  const settings = panel.data?.settings;
  const save = (body, area, message = ["已保存", "Saved"]) => { setNotice(''); return panel.run(async () => { const result = await apiJson('/api/settings', { method: 'PUT', body }); panel.setData(result); setNotice({ area, message }); return result; }); };
  const submit = (event, endpoint, area, message) => { event.preventDefault(); const form = event.currentTarget; const body = Object.fromEntries(new FormData(form)); setNotice(''); panel.run(async () => { await apiJson(endpoint, { method: 'POST', body }); form.reset(); router.refresh(); setNotice({ area, message }); }); };
  const status = area => notice?.area === area ? <p role="status" className="text-sm text-primary">{t(...notice.message)}</p> : null;
  const updatePrompts=async(method,body)=>{const result=await apiJson('/api/settings',{method,body});panel.setData(result);return result.settings.systemPrompts;};
  return <fieldset disabled={panel.busy} className="min-w-0 space-y-5"><ErrorNotice error={panel.error} /><Section title={t("界面语言", "Interface language")} description={t("首次打开时按浏览器语言选择。切换后立即生效。", "The initial language follows your browser. Changes take effect immediately.")}><Field label={t("语言", "Language")}><Select className={inputClass} ariaLabel={t("界面语言", "Interface language")} value={locale} onChange={setLocale} options={[{ id: "zh", label: "中文" }, { id: "en", label: "English" }]} /></Field></Section>{!settings ? <PanelState panel={panel} /> : <>
    <Section title={t("个人资料", "Profile")} description={t("设置你在花卷中使用的头像和昵称。", "Choose your avatar and display name in Huajuan.")}><form className="space-y-4" onSubmit={event => { event.preventDefault(); save({ nickname: new FormData(event.currentTarget).get('nickname') }, 'profile', ["资料已保存", "Profile saved"]); }}>{settings.avatar&&<Image src={settings.avatar} alt={t("我的头像", "Your avatar")} width={64} height={64} unoptimized className="h-16 w-16 rounded-2xl object-cover"/>}<Field label={t("头像", "Avatar")} hint={!settings.avatarFileId ? t("默认头像会随账号固定，也可以上传自己的图片。", "Your default avatar stays with your account. You can also upload your own image.") : undefined}><FileInput type="file" accept="image/*" className={inputClass} disabled={panel.busy} onChange={event => { const file = event.target.files[0]; if (file) panel.run(async () => { const result = await uploadPrivateFile(file, { kind: 'avatar' }); panel.setData(await apiJson('/api/settings', { method: 'PUT', body: { avatarFileId: result.fileId } })); setNotice({ area: 'profile', message: ["头像已更新", "Avatar updated"] }); }); }} /></Field>{settings.avatarFileId && <Action onClick={() => save({ avatarFileId: null }, 'profile', ["已恢复默认头像", "Default avatar restored"])}>{t("恢复默认头像", "Use default avatar")}</Action>}<Field name="nickname" label={t("昵称", "Display name")} defaultValue={settings.nickname} maxLength={50} /><div className="flex flex-wrap items-center gap-3"><Action type="submit" primary disabled={panel.busy}>{t("保存资料", "Save profile")}</Action>{status('profile')}</div></form></Section>
    <Section title={t("外观与提示音", "Appearance and sounds")}><form className="space-y-4" onSubmit={async event => { event.preventDefault(); const form = new FormData(event.currentTarget); const appearance = { themeMode: form.get('themeMode'), fontSize: form.get('fontSize'), completionSoundVolume: Number(form.get('completionSoundVolume')) }; const result = await save({ appearance }, 'appearance'); if (!result) return; setThemeMode(appearance.themeMode); window.localStorage.setItem(UI_FONT_SIZE_KEY, appearance.fontSize); window.localStorage.setItem(UI_COMPLETION_SOUND_VOLUME_KEY, String(appearance.completionSoundVolume)); }}><div className="grid gap-4 sm:grid-cols-2"><Field label={t("主题", "Theme")}><Select className={inputClass} name="themeMode" defaultValue={themeMode} options={[{
  id: "system",
  label: t("跟随系统", "System")
}, {
  id: "light",
  label: t("浅色", "Light")
}, {
  id: "dark",
  label: t("深色", "Dark")
}]} /></Field><Field label={t("文字大小", "Text size")}><Select className={inputClass} name="fontSize" defaultValue={settings.appearance.fontSize} options={[{
  id: "small",
  label: t("小", "Small")
}, {
  id: "medium",
  label: t("标准", "Default")
}, {
  id: "large",
  label: t("大", "Large")
}]} /></Field></div><Field label={t("完成提示音音量", "Completion sound volume")} type="number" name="completionSoundVolume" min={0} max={100} defaultValue={settings.appearance.completionSoundVolume} hint={t("设为 0 可关闭提示音。", "Set to 0 to mute completion sounds.")} /><div className="flex flex-wrap items-center gap-3"><Action type="submit" primary disabled={panel.busy}>{t("保存外观", "Save appearance")}</Action>{status('appearance')}</div></form></Section>
    <Section title={t("对话指令", "Chat instructions")} description={t("设置每次对话遵循的工作要求。当前消息中的明确要求优先。", "Set instructions for every chat. Specific instructions in your current message take priority.")}><form className="space-y-4" onSubmit={event => { event.preventDefault(); save({ chatSystemPrompt: new FormData(event.currentTarget).get('prompt') }, 'prompt', ["指令已保存", "Instructions saved"]); }}><textarea key={settings.chatSystemPrompt} name="prompt" placeholder={t("例如：回答先给结论，引用数据时注明出处。", "For example: Lead with the answer and cite sources for any data.")} aria-label={t("对话指令", "Chat instructions")} className={inputClass} rows={6} maxLength={10000} defaultValue={settings.chatSystemPrompt} /><div className="flex flex-wrap gap-3"><Action type="submit" primary disabled={panel.busy}>{t("保存指令", "Save instructions")}</Action><Action onClick={()=>setTemplatesOpen(true)}>{t("管理指令模板", "Manage instruction templates")}</Action>{status('prompt')}</div></form></Section>
    <SystemPromptModal open={templatesOpen} onClose={()=>setTemplatesOpen(false)} chatSystemPrompt={settings.chatSystemPrompt} systemPrompts={settings.systemPrompts} onChatSystemPromptSave={chatSystemPrompt=>updatePrompts('PUT',{chatSystemPrompt})} addSystemPrompt={(name,content)=>updatePrompts('POST',{name,content})} updateSystemPrompt={(promptId,name,content)=>updatePrompts('PATCH',{promptId,name,content})} deleteSystemPrompt={promptId=>updatePrompts('DELETE',{promptId})}/>
    {!user.isAdmin && <Section title={t("更改邮箱", "Change email")}><form className="space-y-4" onSubmit={event => submit(event, '/api/auth/change-email', 'email', ["邮箱已更新", "Email updated"])}><Field name="newEmail" label={t("新邮箱", "New email address")} type="email" required /><Field name="password" label={t("当前密码", "Current password")} type="password" autoComplete="current-password" required /><div className="flex flex-wrap items-center gap-3"><Action type="submit" primary disabled={panel.busy}>{t("更改邮箱", "Change email")}</Action>{status('email')}</div></form></Section>}
    <Section title={t("更改密码", "Change password")}><form className="space-y-4" onSubmit={event => submit(event, '/api/auth/change-password', 'password', ["密码已更新", "Password updated"])}><Field name="oldPassword" label={t("当前密码", "Current password")} type="password" autoComplete="current-password" required /><Field name="newPassword" label={t("新密码", "New password")} type="password" autoComplete="new-password" required /><Field name="confirmNewPassword" label={t("再次输入新密码", "Confirm new password")} type="password" autoComplete="new-password" required /><div className="flex flex-wrap items-center gap-3"><Action type="submit" primary disabled={panel.busy}>{t("更改密码", "Change password")}</Action>{status('password')}</div></form></Section>
  </>}</fieldset>;
}
