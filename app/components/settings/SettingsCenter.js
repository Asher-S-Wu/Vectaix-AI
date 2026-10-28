"use client";

import { useI18n } from '@/lib/client/i18n';
import { useRef, useState } from 'react';
import Link, { animateChange } from '@/app/components/layout/NavigationMotion';
import { ArrowLeft, Settings2, Sparkles, Plug, Globe, FolderOpen, Archive, ShieldCheck, ChartNoAxesCombined, ChevronRight, Wrench } from 'lucide-react';
import GeneralPanel from './panels/GeneralPanel';
import AssistantPanel from './panels/AssistantPanel';
import ConnectionsPanel from './panels/ConnectionsPanel';
import BrowserPanel from './panels/BrowserPanel';
import FilesPanel from './panels/FilesPanel';
import BackupsPanel from './panels/BackupsPanel';
import PermissionsPanel from './panels/PermissionsPanel';
import UsagePanel from './panels/UsagePanel';
import AdminPanel from '../admin/AdminPanel';

const panels = { general: GeneralPanel, assistant: AssistantPanel, connections: ConnectionsPanel, browser: BrowserPanel, files: FilesPanel, backups: BackupsPanel, permissions: PermissionsPanel, usage: UsagePanel, admin: AdminPanel };
const navigationItemClassName = 'relative isolate flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition-colors';
const inactiveNavigationItemClassName = 'text-zinc-600 hover:bg-zinc-100';

export default function SettingsCenter({ user, initialSection, initialAdminSection = 'models', initialSettings, conversationId, projectId, returnTo = '/' }) {
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
    ...(user.isAdmin ? [['admin', t("管理后台", "Admin"), Wrench, t("模型、技能与平台配置", "Models, skills, and platform settings")]] : []),
  ];

  const initialValid = sections.some(item => item[0] === initialSection);
  const [section, setSection] = useState(initialValid ? initialSection : 'general');
  const [mobileDetail, setMobileDetail] = useState(initialValid && initialSection !== 'general');
  const [adminSection, setAdminSection] = useState(initialAdminSection);
  const contentRef = useRef(null);
  const current = sections.find(item => item[0] === section);
  const Panel = panels[section];
  const select = id => animateChange(() => {
    setSection(id); setMobileDetail(true);
    contentRef.current.scrollTop = 0;
    const url = new URL(window.location.href);
    url.searchParams.set('section', id);
    if (id === 'admin') url.searchParams.set('adminSection', adminSection);
    else url.searchParams.delete('adminSection');
    window.history.replaceState(null, '', url);
  }, 'settings');
  const selectAdmin = id => animateChange(() => {
    setAdminSection(id);
    contentRef.current.scrollTop = 0;
    const url = new URL(window.location.href);
    url.searchParams.set('adminSection', id);
    window.history.replaceState(null, '', url);
  }, 'settings');
  return <div className="h-dvh overflow-hidden bg-app-secondary text-zinc-800">
    <div className="flex h-full">
      <aside className={`workspace-sidebar ${mobileDetail ? 'hidden md:flex' : 'flex'} w-full flex-col border-r border-zinc-200 bg-app-secondary md:w-72 md:shrink-0`}>
        <div className="px-6 pb-6 pt-6"><Link href={returnTo} className="-ml-2 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-primary"><ArrowLeft size={16} />{returnTo.startsWith('/media') ? t('返回媒体创作', 'Back to Media studio') : t("返回对话", "Back to chat")}</Link><h1 className="mt-4 text-2xl font-semibold">{t("设置", "Settings")}</h1><p className="mt-2 truncate text-xs text-zinc-500">{user.email}</p></div>
        <nav aria-label={t("设置分类", "Settings categories")} className="flex-1 space-y-1 overflow-y-auto px-3 pb-6">
          {sections.map(([id, label, Icon, description]) => <button key={id} type="button" onClick={() => select(id)} aria-current={section === id ? 'page' : undefined} className={`${navigationItemClassName} ${section === id ? 'font-semibold text-primary' : inactiveNavigationItemClassName}`}>{section === id && <span aria-hidden="true" style={{ viewTransitionName: "settings-active-tab" }} className="pointer-events-none absolute inset-0 -z-10 rounded-xl bg-primary/10" />}<Icon size={18} strokeWidth={1.7} /><span className="flex-1">{label}<span className="mt-1 block text-xs font-normal text-zinc-500 md:hidden">{description}</span></span><ChevronRight className="text-zinc-400 md:hidden" size={16} /></button>)}
        </nav>
      </aside>
      <main ref={contentRef} style={{ viewTransitionName: "workspace-content" }} className={`${mobileDetail ? 'block' : 'hidden md:block'} min-w-0 flex-1 overflow-y-auto`}>
        <header className="sticky top-0 z-20 border-b border-zinc-200 bg-app-secondary px-5 py-5 sm:px-10"><div className="mx-auto max-w-5xl"><button type="button" className="-ml-2 mb-2 flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-primary md:hidden" onClick={() => animateChange(() => setMobileDetail(false), "settings")}><ArrowLeft size={16} />{t("全部设置", "All settings")}</button><h2 className="text-xl font-semibold">{current[1]}</h2><p className="mt-1 text-sm text-zinc-500">{current[3]}</p></div></header>
        <div className="mx-auto max-w-5xl space-y-5 p-5 pb-16 sm:p-10">{section === 'admin' ? <AdminPanel section={adminSection} onSectionChange={selectAdmin} /> : <Panel key={section} user={user} initialSettings={initialSettings} conversationId={conversationId} projectId={projectId} />}</div>
      </main>
    </div>
  </div>;
}
