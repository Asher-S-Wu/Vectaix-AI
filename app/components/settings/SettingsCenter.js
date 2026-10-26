"use client";

import { useI18n } from '@/lib/client/i18n';
import { useState } from 'react';
import Link, { animateChange } from '@/app/components/layout/NavigationMotion';
import { ArrowLeft, Settings2, Sparkles, Plug, Globe, FolderOpen, Archive, ShieldCheck, ChartNoAxesCombined, ChevronRight } from 'lucide-react';
import TaskNotifications from "../common/TaskNotifications";
import GeneralPanel from './panels/GeneralPanel';
import AssistantPanel from './panels/AssistantPanel';
import ConnectionsPanel from './panels/ConnectionsPanel';
import BrowserPanel from './panels/BrowserPanel';
import FilesPanel from './panels/FilesPanel';
import BackupsPanel from './panels/BackupsPanel';
import PermissionsPanel from './panels/PermissionsPanel';
import UsagePanel from './panels/UsagePanel';

const panels = { general: GeneralPanel, assistant: AssistantPanel, connections: ConnectionsPanel, browser: BrowserPanel, files: FilesPanel, backups: BackupsPanel, permissions: PermissionsPanel, usage: UsagePanel };

export default function SettingsCenter({ user, initialSection, conversationId, projectId, returnTo = '/' }) {
  const { t } = useI18n();
  const sections = [
    ['general', t("通用", "General"), Settings2, t("账号、外观与对话偏好", "Account, appearance, and chat preferences")],
    ['assistant', t("助手", "Assistant"), Sparkles, t("名称、回复语言与工作要求", "Name, reply language, and instructions")],
    ['connections', t("外部连接", "Connections"), Plug, t("连接自己的工具与远程文件", "Connect your tools and remote files")],
    ['browser', t("浏览器", "Browser"), Globe, t("查看和控制网页操作", "View and control browser activity")],
    ['files', t("文件", "Files"), FolderOpen, t("整理个人、对话和项目资料", "Manage personal, chat, and project files")],
    ['backups', t("备份", "Backups"), Archive, t("保存与恢复你的工作资料", "Back up and restore your work")],
    ['permissions', t("权限与安全", "Permissions and security"), ShieldCheck, t("设备权限、连接权限与通行密钥", "Device permissions, connections, and passkeys")],
    ['usage', t("用量与日志", "Usage and logs"), ChartNoAxesCombined, t("查看花费、执行记录和存储占用", "Review costs, activity, and storage")],
  ];

  const available = sections.filter(item => !item[4] || user.isAdmin);
  const [section, setSection] = useState(available.some(item => item[0] === initialSection) ? initialSection : 'general');
  const [mobileDetail, setMobileDetail] = useState(initialSection !== 'general');
  const current = available.find(item => item[0] === section);
  const Panel = panels[section];
  const select = id => animateChange(() => { setSection(id); setMobileDetail(true); const url = new URL(window.location.href); url.searchParams.set('section', id); window.history.replaceState(null, '', url); }, 'settings');
  return <div className="h-dvh overflow-hidden bg-app-secondary text-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
    <TaskNotifications userId={user.userId} />
    <div className="mx-auto flex h-full max-w-[1440px]">
      <aside style={{ viewTransitionName: "settings-sidebar" }} className={`${mobileDetail ? 'hidden md:flex' : 'flex'} w-full flex-col border-r border-zinc-200 bg-white md:w-64 md:shrink-0 dark:border-zinc-800 dark:bg-zinc-900/40`}>
        <div className="px-6 pb-6 pt-7"><Link href={returnTo} className="inline-flex min-h-11 items-center gap-2 text-sm text-zinc-500 hover:text-primary"><ArrowLeft size={16} />{returnTo.startsWith('/media') ? t('返回 Media', 'Back to Media') : t("返回对话", "Back to chat")}</Link><h1 className="mt-5 text-2xl font-semibold tracking-tight">{t("设置", "Settings")}</h1><p className="mt-2 truncate text-xs text-zinc-500">{user.email}</p></div>
        <nav aria-label={t("设置分类", "Settings categories")} className="flex-1 space-y-1 overflow-y-auto px-3 pb-6">{available.map(([id, label, Icon, description, admin]) => <button key={id} type="button" onClick={() => select(id)} aria-current={section === id ? 'page' : undefined} className={`relative isolate flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition-colors ${section === id ? 'font-semibold text-primary' : 'text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800'}`}>{section === id && <span aria-hidden="true" style={{ viewTransitionName: "settings-active-tab" }} className="pointer-events-none absolute inset-0 -z-10 rounded-xl bg-primary/10" />}<Icon size={18} strokeWidth={1.7} /><span className="flex-1">{label}<span className="mt-1 block text-xs font-normal text-zinc-400 md:hidden">{description}</span></span>{admin && <span className="text-[10px]">{t("管理", "Manage")}</span>}<ChevronRight className="md:hidden" size={16} /></button>)}</nav>{user.isAdmin && <Link href="/admin" className="mx-6 mb-6 inline-flex items-center gap-2 text-sm text-primary"><ShieldCheck size={16} />{t("管理后台", "Admin")}</Link>}
      </aside>
      <main style={{ viewTransitionName: "settings-content" }} className={`${mobileDetail ? 'block' : 'hidden md:block'} min-w-0 flex-1 overflow-y-auto`}>
        <header className="sticky top-0 z-20 border-b border-zinc-200/70 bg-app-secondary px-5 py-5 backdrop-blur sm:px-10 dark:border-zinc-800 dark:bg-zinc-950/95"><button className="mb-4 flex items-center gap-1 text-sm text-zinc-500 md:hidden" onClick={() => animateChange(() => setMobileDetail(false), "settings")}><ArrowLeft size={16} />{t("全部设置", "All settings")}</button><h2 className="text-xl font-semibold tracking-tight">{current[1]}</h2><p className="mt-1 text-sm text-zinc-500">{current[3]}</p></header>
        <div className="mx-auto max-w-5xl space-y-5 p-5 pb-16 sm:p-10">{<Panel key={section} user={user} conversationId={conversationId} projectId={projectId} />}</div>
      </main>
    </div>
  </div>;
}
