"use client";

import { useState } from 'react';
import { startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { apiJson } from '@/lib/client/apiClient';
import { PERMISSION_LABELS } from '@/lib/shared/preferences.mjs';
import { Section, Toggle, Field, Action, ErrorNotice, usePanelData } from '../SettingsUI';

export default function PermissionsPanel() {
  const panel = usePanelData('/api/settings');
  const keys = usePanelData('/api/auth/passkeys');
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState(null);
  const requestPermission = async (key, enabled) => {
    if (enabled) {
      if (key === 'microphone' || key === 'camera') {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器不支持录音或拍照');
        const stream = await navigator.mediaDevices.getUserMedia(key === 'camera' ? { video: true } : { audio: true });
        stream.getTracks().forEach(track => track.stop());
      }
      if (key === 'notifications') {
        if (!('Notification' in window)) throw new Error('当前浏览器不支持页面通知');
        if (await Notification.requestPermission() !== 'granted') throw new Error('通知权限未获允许');
        try { const notification = new Notification('Vectaix 通知已开启', {body:'页面打开期间，任务完成后会在这里提醒你。'}); setTimeout(()=>notification.close(),3000); } catch { throw new Error('当前浏览器不支持页面通知'); }
      }
      if (key === 'clipboard' && !navigator.clipboard?.readText) throw new Error('当前浏览器不支持读取剪贴板');
      if (key === 'geolocation') {
        if (!navigator.geolocation) throw new Error('当前浏览器不支持定位');
        await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 }));
      }
    }
    panel.setData(await apiJson('/api/settings', { method: 'PUT', body: { permissions: { [key]: enabled } } }));
  };
  return <><ErrorNotice error={panel.error || keys.error} /><Section title="功能权限" description="设备能力只在你主动使用时调用。浏览器自己的授权仍由你决定。关闭权限会停止正在执行的任务。">{panel.data && Object.entries(PERMISSION_LABELS).map(([key, label]) => <Toggle key={key} label={label} description={key === 'browser' || key === 'externalTools' ? '对外提交或修改前仍需确认具体内容。' : undefined} checked={panel.data.settings.permissions[key]} disabled={panel.busy} onChange={value => panel.run(() => requestPermission(key, value))} />)}</Section>
    <Section title="通行密钥" description="使用设备的指纹、面容或屏幕锁登录。密码登录仍可由你主动选择。"><Field label="通行密钥名称" value={name} onChange={event => setName(event.target.value)} placeholder="例如：我的笔记本" maxLength={100} /><Action primary disabled={keys.busy} onClick={() => keys.run(async () => { if (!browserSupportsWebAuthn()) throw new Error('当前浏览器不支持通行密钥'); const result = await apiJson('/api/auth/passkeys', { method: 'POST', body: { action: 'registration-options', name } }); const response = await startRegistration({ optionsJSON: result.options }).catch(error => { throw new Error(error.name === 'NotAllowedError' || error.cause?.name === 'NotAllowedError' ? '通行密钥验证已取消' : '设备验证未完成，请允许通行密钥授权'); }); await apiJson('/api/auth/passkeys', { method: 'POST', body: { action: 'registration-verify', challengeId: result.challengeId, response } }); await keys.reload(); setName(''); })}>添加通行密钥</Action>
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">{keys.data?.passkeys.map(key => <div key={key._id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div><p className="text-sm font-medium">{key.name}</p><p className="mt-1 text-xs text-zinc-500">添加于 {new Date(key.createdAt).toLocaleDateString('zh-CN')}{key.lastUsedAt && ` · 最近使用 ${new Date(key.lastUsedAt).toLocaleDateString('zh-CN')}`}</p></div>{deleting === key._id ? <div className="flex gap-2"><Action danger disabled={keys.busy} onClick={() => keys.run(async () => { await apiJson('/api/auth/passkeys', { method: 'DELETE', body: { id: key._id } }); await keys.reload(); setDeleting(null); })}>确认移除</Action><Action onClick={() => setDeleting(null)}>取消</Action></div> : <Action onClick={() => setDeleting(key._id)}>移除</Action>}</div>)}</div>
    </Section></>;
}
