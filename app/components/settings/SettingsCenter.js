"use client";

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Settings2, Sparkles, BookOpen, Brain, Plug, Globe, FolderOpen, Archive, ShieldCheck, ChartNoAxesCombined, SlidersHorizontal, Coins, ChevronRight, Paintbrush, Users } from 'lucide-react';
import TaskNotifications from "../common/TaskNotifications";
import GeneralPanel from './panels/GeneralPanel';
import AssistantPanel from './panels/AssistantPanel';
import MemoryPanel from './panels/MemoryPanel';
import SkillsPanel from './panels/SkillsPanel';
import ConnectionsPanel from './panels/ConnectionsPanel';
import BrowserPanel from './panels/BrowserPanel';
import FilesPanel from './panels/FilesPanel';
import BackupsPanel from './panels/BackupsPanel';
import PermissionsPanel from './panels/PermissionsPanel';
import UsagePanel from './panels/UsagePanel';
import ModelsPanel from './panels/ModelsPanel';
import MediaPanel from './panels/MediaPanel';
import UsersPanel from './panels/UsersPanel';
import BillingSettingsPanel from './BillingSettingsPanel';

const sections = [
  ['general', '通用', Settings2, '账号、外观与对话偏好'],
  ['assistant', '助手', Sparkles, '让助手熟悉你的工作方式'],
  ['skills', '技能', BookOpen, '管理专业方法和配套资料'],
  ['memory', '记忆', Brain, '管理值得长期保留的信息'],
  ['connections', '外部连接', Plug, '连接自己的工具与远程文件'],
  ['browser', '浏览器', Globe, '查看和控制网页操作'],
  ['files', '文件', FolderOpen, '整理个人、对话和项目资料'],
  ['backups', '备份', Archive, '保存与恢复你的工作资料'],
  ['media', '创作', Paintbrush, '图片、配音、视频与朗读'],
  ['permissions', '权限与安全', ShieldCheck, '设备权限、连接权限与通行密钥'],
  ['usage', '用量与日志', ChartNoAxesCombined, '查看积分、执行记录和存储占用'],
  ['models', '模型管理', SlidersHorizontal, '管理平台模型与价格', true],
  ['users', '用户管理', Users, '管理账号与用户积分', true],
  ['billing', '积分与费率', Coins, '积分规则与媒体费率', true],
];
const panels = { general: GeneralPanel, assistant: AssistantPanel, skills: SkillsPanel, memory: MemoryPanel, connections: ConnectionsPanel, browser: BrowserPanel, files: FilesPanel, backups: BackupsPanel, permissions: PermissionsPanel, usage: UsagePanel, models: ModelsPanel, media: MediaPanel, users:UsersPanel };

export default function SettingsCenter({ user, initialSection, conversationId, projectId }) {
  const available = sections.filter(item => !item[4] || user.isAdmin);
  const [section, setSection] = useState(available.some(item => item[0] === initialSection) ? initialSection : 'general');
  const [mobileDetail, setMobileDetail] = useState(initialSection !== 'general');
  const current = available.find(item => item[0] === section);
  const Panel = panels[section];
  const select = id => { setSection(id); setMobileDetail(true); const url = new URL(window.location.href); url.searchParams.set('section', id); window.history.replaceState(null, '', url); };
  return <div className="h-dvh overflow-hidden bg-[#f8f9fb] text-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
    <TaskNotifications userId={user.userId} />
    <div className="mx-auto flex h-full max-w-[1440px]">
      <aside className={`${mobileDetail ? 'hidden md:flex' : 'flex'} w-full flex-col border-r border-zinc-200 bg-white md:w-64 md:shrink-0 dark:border-zinc-800 dark:bg-zinc-900/40`}>
        <div className="px-6 pb-6 pt-7"><Link href="/" className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-primary"><ArrowLeft size={16} />返回对话</Link><h1 className="mt-7 text-2xl font-semibold tracking-tight">设置</h1><p className="mt-2 truncate text-xs text-zinc-500">{user.email}</p></div>
        <nav aria-label="设置分类" className="flex-1 space-y-1 overflow-y-auto px-3 pb-6">{available.map(([id, label, Icon, description, admin]) => <button key={id} type="button" onClick={() => select(id)} aria-current={section === id ? 'page' : undefined} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition-colors ${section === id ? 'bg-primary/10 font-semibold text-primary' : 'text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800'}`}><Icon size={18} strokeWidth={1.7} /><span className="flex-1">{label}<span className="mt-1 block text-xs font-normal text-zinc-400 md:hidden">{description}</span></span>{admin && <span className="text-[10px]">管理</span>}<ChevronRight className="md:hidden" size={16} /></button>)}</nav>
      </aside>
      <main className={`${mobileDetail ? 'block' : 'hidden md:block'} min-w-0 flex-1 overflow-y-auto`}>
        <header className="sticky top-0 z-20 border-b border-zinc-200/70 bg-[#f8f9fb]/95 px-5 py-5 backdrop-blur sm:px-10 dark:border-zinc-800 dark:bg-zinc-950/95"><button className="mb-4 flex items-center gap-1 text-sm text-zinc-500 md:hidden" onClick={() => setMobileDetail(false)}><ArrowLeft size={16} />全部设置</button><h2 className="text-xl font-semibold tracking-tight">{current[1]}</h2><p className="mt-1 text-sm text-zinc-500">{current[3]}</p></header>
        <div className="mx-auto max-w-5xl space-y-5 p-5 pb-16 sm:p-10">{Panel ? <Panel key={section} user={user} conversationId={conversationId} projectId={projectId} /> : <BillingSettingsPanel active />}</div>
      </main>
    </div>
  </div>;
}
