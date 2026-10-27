"use client";

import { useI18n } from "@/lib/client/i18n";

import { useState } from "react";
import { Folder, Plus } from "lucide-react";
import { apiJson } from "@/lib/client/apiClient";
import ChatSettingsDialog, { SettingsFields, buttonClass } from "./ChatSettingsDialog";

export default function ProjectManager({ open, onClose, projects, onChanged, onSelectProject }) {
  const { t, localizeMessage } = useI18n();
  const [editor, setEditor] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!open) return null;
  const run = async action => { setBusy(true); setError(""); try { await action(); } catch (failure) { setError(failure.message); } finally { setBusy(false); } };
  return <ChatSettingsDialog busy={busy} title={editor ? editor._id ? t("编辑项目", "Edit project") : t("创建项目", "Create project") : t("管理项目", "Manage projects")} onClose={() => { setEditor(null); setDeleting(null); setError(""); onClose(); }}>
    {error && <p role="alert" className="text-sm text-red-500">{localizeMessage(error)}</p>}
    {editor ? <SettingsFields key={editor._id || "new"} fields={[{ name: "name", label: t("项目名称", "Project name"), value: editor.name, required: true, maxLength: 100 }, { name: "description", label: t("项目介绍", "Description"), value: editor.description, multiline: true, rows: 2, maxLength: 2000 }, { name: "instructions", label: t("项目指令", "Project instructions"), value: editor.instructions, multiline: true, maxLength: 20000, hint: t("告诉 AI 这个项目的目标、工作方式和需要遵守的要求。", "Describe the project goal, how you want to work, and any requirements.") }]} busy={busy} onCancel={() => { setEditor(null); setError(""); }} onSubmit={values => run(async () => { const result = await apiJson(`/api/projects${editor._id ? `/${editor._id}` : ""}`, { method: editor._id ? "PUT" : "POST", body: values }); await onChanged(); if (!editor._id) onSelectProject(result.project._id); setEditor(null); })} /> : <>
      <button type="button" className={buttonClass} disabled={busy} onClick={() => { setError(""); setEditor({}); }}><Plus size={15} />{t("创建项目", "Create project")}</button>
      {!projects.length && <p className="py-6 text-center text-sm text-zinc-500">{t("按项目整理对话，共享资料和工作要求。", "Create a project to organize chats and share files and instructions.")}</p>}
      {projects.map(project => <div key={project._id} className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 space-y-2"><div className="flex min-w-0 items-center gap-2 font-medium text-sm"><Folder size={16} className="shrink-0 text-primary" /><span className="min-w-0 break-words">{project.name}</span></div>{project.description && <p className="text-sm text-zinc-500 whitespace-pre-wrap break-words">{project.description}</p>}<div className="flex gap-2"><button type="button" className={buttonClass} disabled={busy} onClick={() => { setError(""); setEditor(project); }}>{t("编辑", "Edit")}</button><button type="button" className={`${buttonClass} text-red-600`} disabled={busy} onClick={() => setDeleting(project)}>{t("删除", "Delete")}</button></div>{deleting?._id === project._id && <div role="alert" className="border-t border-zinc-200 dark:border-zinc-700 pt-3 space-y-3"><p className="text-sm text-zinc-600">{t("删除项目及共享资料？对话及其附件、任务历史和成果将保留，并移至未归类。使用中的共享资料须先从相关消息移除引用。此操作无法撤销。", "Delete this project and its shared files? Its chats, attachments, task history, and results will move to Uncategorized. Remove references to shared files from related messages first. This action is permanent.")}</p><div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={busy} onClick={() => setDeleting(null)}>{t("取消", "Cancel")}</button><button type="button" className="min-h-10 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50" disabled={busy} onClick={() => run(async () => { await apiJson(`/api/projects/${project._id}`, { method: "DELETE" }); await onChanged(); setDeleting(null); })}>{busy ? t("正在删除…", "Deleting…") : t("确认删除", "Delete permanently")}</button></div></div>}</div>)}
    </>}
  </ChatSettingsDialog>;
}
