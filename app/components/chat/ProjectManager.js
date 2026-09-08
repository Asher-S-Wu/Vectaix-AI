"use client";

import { useState } from "react";
import { Folder, Plus } from "lucide-react";
import { apiJson } from "@/lib/client/apiClient";
import ChatSettingsDialog, { SettingsFields, buttonClass } from "./ChatSettingsDialog";

export default function ProjectManager({ open, onClose, projects, onChanged, onSelectProject }) {
  const [editor, setEditor] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!open) return null;
  const run = async action => { setBusy(true); setError(""); try { await action(); } catch (failure) { setError(failure.message); } finally { setBusy(false); } };
  return <ChatSettingsDialog title={editor ? editor._id ? "编辑项目" : "创建项目" : "管理项目"} onClose={() => { setEditor(null); setDeleting(null); onClose(); }}>
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    {editor ? <SettingsFields key={editor._id || "new"} fields={[{ name: "name", label: "项目名称", value: editor.name, required: true, maxLength: 100 }, { name: "description", label: "项目介绍", value: editor.description, multiline: true, rows: 2, maxLength: 2000 }, { name: "instructions", label: "项目指令", value: editor.instructions, multiline: true, maxLength: 20000, hint: "告诉 AI 这个项目的目标、工作方式和需要遵守的要求。" }]} busy={busy} onCancel={() => setEditor(null)} onSubmit={values => run(async () => { const result = await apiJson(`/api/projects${editor._id ? `/${editor._id}` : ""}`, { method: editor._id ? "PUT" : "POST", body: values }); await onChanged(); if (!editor._id) onSelectProject(result.project._id); setEditor(null); })} /> : <>
      <button className={buttonClass} onClick={() => setEditor({})}><Plus size={15} />创建项目</button>
      {!projects.length && <p className="py-6 text-center text-sm text-zinc-500">按项目整理对话，共享资料和工作要求。</p>}
      {projects.map(project => <div key={project._id} className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 space-y-2"><div className="flex items-center gap-2 font-medium text-sm"><Folder size={16} className="text-primary" />{project.name}</div>{project.description && <p className="text-sm text-zinc-500 whitespace-pre-wrap">{project.description}</p>}<div className="flex gap-4 text-xs"><button className="text-primary" onClick={() => setEditor(project)}>编辑</button><button className="text-red-500" onClick={() => setDeleting(project)}>删除</button></div>{deleting?._id === project._id && <div className="border-t border-zinc-200 dark:border-zinc-700 pt-3 space-y-3"><p className="text-sm text-zinc-500">删除项目共享资料和项目记忆？对话及其附件、任务历史和成果将保留，并移至未归类。此操作无法撤销。</p><div className="flex gap-2"><button className={buttonClass} disabled={busy} onClick={() => setDeleting(null)}>取消</button><button className="text-sm text-red-500" disabled={busy} onClick={() => run(async () => { await apiJson(`/api/projects/${project._id}`, { method: "DELETE" }); await onChanged(); onSelectProject("all"); setDeleting(null); })}>确认删除</button></div></div>}</div>)}
    </>}
  </ChatSettingsDialog>;
}
