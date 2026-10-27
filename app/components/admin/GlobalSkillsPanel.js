'use client';

import { useI18n } from "@/lib/client/i18n";

import { useEffect, useState } from 'react';
import { BookOpen, Download, RefreshCw, Trash2 } from 'lucide-react';
import { AdminField, AdminNotice, adminRequest } from './AdminUI';

export default function GlobalSkillsPanel() {
  const { t, formatNumber } = useI18n();

  const [skills, setSkills] = useState(null);
  const [source, setSource] = useState('');
  const [skill, setSkill] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [output, setOutput] = useState('');
  const [deleting, setDeleting] = useState(null);
  useEffect(() => { let active = true; adminRequest('/api/admin/skills').then(data => { if (active) setSkills(data.skills); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, []);
  const run = async (name, action) => { setBusy(name); setError(''); setNotice(''); setOutput(''); try { const result = await action(); if (result.output) setOutput(result.output); setSkills((await adminRequest('/api/admin/skills')).skills); setNotice(["全局技能已更新，花卷会在新任务中按需使用。", "Global skills updated. Huajuan will use them as needed in new tasks."]); } catch (e) { setError(e.message); } finally { setBusy(''); setDeleting(null); } };
  return <>
    <header className="admin-page-heading"><h1>{t("全局技能", "Global skills")}</h1><p>{t("由管理员通过 Skills CLI 安装与维护。启用的技能对所有用户生效。", "Admins install and manage skills with Skills CLI. Enabled skills are available to all users.")}</p></header>
    <AdminNotice error={error} notice={notice} />
    <form className="admin-section" onSubmit={event => { event.preventDefault(); run('install', () => adminRequest('/api/admin/skills', { method: 'POST', body: { source, ...(skill.trim() ? { skill: skill.trim() } : {}) } })); }}>
      <fieldset disabled={Boolean(busy)} className="min-w-0"><div className="admin-section-title"><h2>{t("安装技能", "Install skills")}</h2><p>{t("输入公开 GitHub 仓库，安装其中的工作方法与参考资料。", "Enter a public GitHub repository to install its workflows and reference material.")}</p></div>
      <div className="admin-field-grid"><AdminField label={t("GitHub 来源", "GitHub repository")} value={source} onChange={event => setSource(event.target.value)} placeholder="owner/repository" required /><AdminField label={t("技能名称（选填）", "Skill name (optional)")} value={skill} onChange={event => setSkill(event.target.value)} placeholder={t("留空安装仓库中的全部技能", "Leave blank to install all skills in the repository")} /></div>
      <button type="submit" className="admin-button primary" disabled={Boolean(busy)}><Download size={16} />{busy === 'install' ? t("Skills CLI 正在安装…", "Installing with Skills CLI…") : t("安装技能", "Install skills")}</button>
    </fieldset></form>
    <section className="admin-section"><div className="admin-section-title"><h2>{t("全局技能库", "Global skills")}{skills && <span className="ml-2 text-sm font-normal text-zinc-500">{t("{count} 个", skills.length === 1 ? "{count} skill" : "{count} skills", { count: formatNumber(skills.length) })}</span>}</h2><p>{t("花卷按任务需要读取已启用的技能。", "Huajuan reads enabled skills when a task calls for them.")}</p></div>
      {skills === null ? <p className="py-6 text-sm text-zinc-500">{error ? t("技能列表加载失败，请刷新重试。", "The skill list failed to load. Refresh to try again.") : t("正在读取技能库…", "Loading skills…")}</p> : skills.length === 0 ? <div className="admin-empty"><BookOpen size={28} /><h3>{t("添加第一个技能", "Add your first skill")}</h3><p>{t("在上方安装技能，让花卷学会你希望统一使用的工作流程。", "Install a skill above to give Huajuan a shared workflow.")}</p></div> : <div className="admin-skill-list">{skills.map(item => <article key={item._id} className="admin-skill"><div className="min-w-0 flex-1"><h3>{item.name}</h3><p>{item.description}</p><span className="mt-2 block break-all text-xs text-zinc-400">{item.source?.url}</span></div><div className="flex shrink-0 flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-xs"><input type="checkbox" className="h-4 w-4 accent-primary" checked={item.enabled} disabled={Boolean(busy)} onChange={event => run(item._id, () => adminRequest(`/api/admin/skills/${item._id}`, { method: 'PATCH', body: { enabled: event.target.checked } }))} />{item.enabled ? t("已启用", "Enabled") : t("已停用", "Disabled")}</label><button type="button" className="admin-icon-button" title={t("更新 {name}", "Update {name}", { name: item.name })} aria-label={t("更新 {name}", "Update {name}", { name: item.name })} disabled={Boolean(busy)} onClick={() => run(item._id, () => adminRequest(`/api/admin/skills/${item._id}/update`, { method: 'POST' }))}><RefreshCw size={16} className={busy === item._id ? 'animate-spin motion-reduce:animate-none' : ''} /></button><button type="button" className="admin-icon-button text-red-500" title={t("删除 {name}", "Delete {name}", { name: item.name })} aria-label={t("删除 {name}", "Delete {name}", { name: item.name })} disabled={Boolean(busy)} onClick={() => setDeleting(item._id)}><Trash2 size={16} /></button></div>{deleting === item._id && <div className="flex w-full flex-wrap items-center gap-3 border-t border-zinc-200 pt-3 text-sm dark:border-zinc-700"><span>{t("从全平台删除「{name}」？", "Delete “{name}” for all users?", { name: item.name })}</span><button type="button" className="admin-button" disabled={Boolean(busy)} onClick={() => setDeleting(null)}>{t("取消", "Cancel")}</button><button type="button" className="admin-button border-red-200 text-red-600 hover:border-red-400 dark:border-red-900 dark:text-red-300" disabled={Boolean(busy)} onClick={() => run(item._id, () => adminRequest(`/api/admin/skills/${item._id}`, { method: 'DELETE' }))}>{busy === item._id ? t("正在删除…", "Deleting…") : t("确认删除", "Delete")}</button></div>}</article>)}</div>}
    </section>
    {output && <details className="admin-section"><summary className="cursor-pointer text-sm text-zinc-500">{t("查看 Skills CLI 执行记录", "View Skills CLI output")}</summary><pre className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs leading-6">{output}</pre></details>}
  </>;
}
