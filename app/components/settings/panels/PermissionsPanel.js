"use client";

import { useI18n } from '@/lib/client/i18n';
import { useState } from 'react';
import { startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { apiJson } from '@/lib/client/apiClient';
import { Section, Toggle, Field, Action, ErrorNotice, usePanelData } from '../SettingsUI';

export default function PermissionsPanel() {
  const { t, formatDate } = useI18n();
  const permissionLabels = { notifications: t("完成通知", "Completion notifications"), browser: t("网页操作", "Browser actions"), externalTools: t("外部工具", "External tools") };

  const panel = usePanelData('/api/settings');
  const keys = usePanelData('/api/auth/passkeys');
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState(null);
  const requestPermission = async (key, enabled) => {
    if (enabled && key === 'notifications') {
      if (!('Notification' in window)) throw new Error(t("当前浏览器不支持页面通知", "Notifications are unavailable in this browser."));
      if (await Notification.requestPermission() !== 'granted') throw new Error(t("通知权限未获允许", "Allow notifications in your browser settings."));
      try { const notification = new Notification(t("花卷通知已开启", "Huajuan notifications enabled"), {body:t("页面打开期间，任务完成后会在这里提醒你。", "While this page is open, you will receive a notification when a task finishes.")}); setTimeout(()=>notification.close(),3000); } catch { throw new Error(t("当前浏览器不支持页面通知", "Notifications are unavailable in this browser.")); }
    }
    panel.setData(await apiJson('/api/settings', { method: 'PUT', body: { permissions: { [key]: enabled } } }));
  };
  return <><ErrorNotice error={panel.error || keys.error} /><Section title={t("功能权限", "Feature permissions")} description={t("管理完成通知、网页操作和外部工具。关闭权限会停止正在执行的任务。", "Manage completion notifications, browser actions, and external tools. Turning off a permission stops active tasks.")}>{panel.data && Object.entries(permissionLabels).map(([key, label]) => <Toggle key={key} label={label} description={key === 'browser' || key === 'externalTools' ? t("对外提交或修改前需确认具体内容。", "Review and confirm the content before external submissions or changes.") : undefined} checked={panel.data.settings.permissions[key]} disabled={panel.busy} onChange={value => panel.run(() => requestPermission(key, value))} />)}</Section>
    <Section title={t("通行密钥", "Passkeys")} description={t("使用设备的指纹、面容或屏幕锁登录。也可以继续使用密码登录。", "Sign in with your device’s fingerprint, face recognition, or screen lock. Password sign-in also remains available.")}><Field label={t("通行密钥名称", "Passkey name")} value={name} onChange={event => setName(event.target.value)} placeholder={t("例如：我的笔记本", "For example, My laptop")} maxLength={100} /><Action primary disabled={keys.busy} onClick={() => keys.run(async () => { if (!browserSupportsWebAuthn()) throw new Error(t("当前浏览器不支持通行密钥", "Passkeys are unavailable in this browser.")); const result = await apiJson('/api/auth/passkeys', { method: 'POST', body: { action: 'registration-options', name } }); const response = await startRegistration({ optionsJSON: result.options }).catch(error => { throw new Error(error.name === 'NotAllowedError' || error.cause?.name === 'NotAllowedError' ? t("通行密钥验证已取消", "Passkey verification canceled") : t("设备验证未完成，请允许通行密钥授权", "Complete device verification to authorize this passkey.")); }); await apiJson('/api/auth/passkeys', { method: 'POST', body: { action: 'registration-verify', challengeId: result.challengeId, response } }); await keys.reload(); setName(''); })}>{t("添加通行密钥", "Add passkey")}</Action>
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">{keys.data?.passkeys.map(key => <div key={key._id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div><p className="text-sm font-medium">{key.name}</p><p className="mt-1 text-xs text-zinc-500">{t("添加于 {date}", "Added {date}", { date: formatDate(key.createdAt) })}{key.lastUsedAt && t(" · 最近使用 {date}", " · Last used {date}", { date: formatDate(key.lastUsedAt) })}</p></div>{deleting === key._id ? <div className="flex gap-2"><Action danger disabled={keys.busy} onClick={() => keys.run(async () => { await apiJson('/api/auth/passkeys', { method: 'DELETE', body: { id: key._id } }); await keys.reload(); setDeleting(null); })}>{t("确认移除", "Confirm removal")}</Action><Action onClick={() => setDeleting(null)}>{t("取消", "Cancel")}</Action></div> : <Action onClick={() => setDeleting(key._id)}>{t("移除", "Remove")}</Action>}</div>)}</div>
    </Section></>;
}
