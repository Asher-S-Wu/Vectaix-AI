"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Upload } from "lucide-react";
import { apiJson } from "@/lib/client/apiClient";
import ChatSettingsDialog, { SettingsFields, SettingsToggle, buttonClass } from "./ChatSettingsDialog";
import { mediaSettingsFields, parseMediaSettings } from "./mediaSettingsFields";

export default function ChatCapabilitiesSettings(props) {
  if (!props.open) return null;
  return <CapabilitiesContent key={`${props.section}:${props.projectId || "personal"}`} {...props} />;
}

function CapabilitiesContent({ section, onClose, projectId, mediaSettings, onMediaSettingsChange, onChanged }) {
  const [skills, setSkills] = useState([]);
  const [memories, setMemories] = useState([]);
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [project, setProject] = useState(null);
  const [editor, setEditor] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(section !== "media");
  const [error, setError] = useState("");
  const importRef = useRef(null);
  const memoryPath = `/api/memories${projectId ? `?projectId=${projectId}` : ""}`;
  useEffect(() => {
    let disposed = false;
    async function load() {
      try {
        if (section === "skills") { const result = await apiJson("/api/skills"); if (!disposed) setSkills(result.skills); }
        if (section === "memory") {
          const results = await Promise.all([apiJson(memoryPath), apiJson("/api/memories/settings"), ...(projectId ? [apiJson(`/api/projects/${projectId}`)] : [])]);
          if (!disposed) { setMemories(results[0].memories); setMemoryEnabled(results[1].enabled); if (projectId) setProject(results[2].project); }
        }
      } catch (failure) { if (!disposed) setError(failure.message); } finally { if (!disposed) setLoading(false); }
    }
    load(); return () => { disposed = true; };
  }, [section, projectId, memoryPath]);
  const run = async action => { if (busy) return; setBusy(true); setError(""); try { await action(); await onChanged?.(); } catch (failure) { setError(failure.message); } finally { setBusy(false); } };
  const editSkill = (item, content = "") => setEditor({ item, fields: [{ name: "name", label: "技能名称", value: item?.name, required: true, maxLength: 100 }, { name: "description", label: "何时使用", value: item?.description, multiline: true, rows: 2 }, { name: "content", label: "技能内容", value: item ? item.content : content, required: true, multiline: true, rows: 10 }] });
  const editMemory = item => setEditor({ item, fields: [{ name: "content", label: "希望 AI 记住什么？", value: item?.content, required: true, multiline: true }, { name: "projectId", label: "使用范围", type: "select", value: item ? item.projectId || "" : projectId || "", options: [{ value: "", label: "个人记忆" }, ...(project ? [{ value: projectId, label: `项目记忆 · ${project.name}` }] : [])] }] });
  const save = values => run(async () => {
    const kind = section === "skills" ? "skill" : "memory";
    if (kind === "memory") values.projectId = values.projectId || null;
    if (kind === "skill") values.enabled = editor.item ? editor.item.enabled : true;
    const result = await apiJson(`/api/${section === "skills" ? "skills" : "memories"}${editor.item ? `/${editor.item._id}` : ""}`, { method: editor.item ? "PUT" : "POST", body: values });
    if (kind === "skill") setSkills(items => editor.item ? items.map(item => item._id === result.skill._id ? result.skill : item) : [result.skill, ...items]);
    else setMemories((await apiJson(memoryPath)).memories);
    setEditor(null);
  });
  return <ChatSettingsDialog title={editor ? section === "skills" ? editor.item ? "编辑技能" : "添加技能" : editor.item ? "编辑记忆" : "添加记忆" : { skills: "技能", memory: "记忆", media: "创作设置" }[section]} onClose={onClose}>
    {error && <p className="text-sm text-red-500" role="alert">{error}</p>}
    {loading ? <p className="text-sm text-zinc-500">正在加载…</p> : section === "media" ? <><p className="text-sm text-zinc-500">为对话中的图片、配音和视频创作选择参数。</p><SettingsFields fields={mediaSettingsFields(mediaSettings)} busy={busy} onCancel={onClose} onSubmit={values => run(async () => { await onMediaSettingsChange(parseMediaSettings(values)); onClose(); })} /></> : editor ? <SettingsFields key={editor.item?._id || "new"} fields={editor.fields} busy={busy} onCancel={() => setEditor(null)} onSubmit={save} /> : <>
      <p className="text-sm text-zinc-500">{section === "skills" ? "启用专业方法，让 AI 按你的工作方式完成任务。" : "保存个人偏好和项目中的重要信息。"}</p>
      {section === "memory" && <div className="space-y-4 rounded-xl bg-zinc-50 dark:bg-zinc-800 p-4"><SettingsToggle label="个人记忆" checked={memoryEnabled} disabled={busy} onChange={() => run(async () => { setMemoryEnabled((await apiJson("/api/memories/settings", { method: "PUT", body: { enabled: !memoryEnabled } })).enabled); })} />{project && <SettingsToggle label="当前项目记忆" checked={project.memoryEnabled} disabled={busy} onChange={() => run(async () => { setProject((await apiJson(`/api/projects/${projectId}`, { method: "PUT", body: { memoryEnabled: !project.memoryEnabled } })).project); })} />}</div>}
      <div className="flex gap-2"><button className={buttonClass} disabled={busy} onClick={() => section === "skills" ? editSkill(null) : editMemory(null)}><Plus size={15} />{section === "skills" ? "添加技能" : "添加记忆"}</button>{section === "skills" && <><input ref={importRef} hidden type="file" accept=".md,text/markdown,text/plain" onChange={event => { const file = event.target.files[0]; event.target.value = ""; if (file) run(async () => editSkill(null, await file.text())); }} /><button className={buttonClass} disabled={busy} onClick={() => importRef.current.click()}><Upload size={15} />导入技能</button></>}</div>
      {(section === "skills" ? skills : memories).map(item => <div key={item._id} className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 space-y-3">{section === "skills" ? <><SettingsToggle label={item.name} checked={item.enabled} disabled={busy} onChange={() => run(async () => { const result = await apiJson(`/api/skills/${item._id}`, { method: "PUT", body: { enabled: !item.enabled } }); setSkills(items => items.map(skill => skill._id === item._id ? result.skill : skill)); })} /><p className="text-sm text-zinc-500">{item.description}</p>{item.builtinKey && <span className="text-xs text-primary">内置技能</span>}</> : <><span className="text-xs text-primary">{item.projectId ? "项目记忆" : "个人记忆"}</span><p className="text-sm whitespace-pre-wrap">{item.content}</p></>}<div className="flex gap-4 text-xs"><button onClick={() => section === "skills" ? editSkill(item) : editMemory(item)} className="text-primary">编辑</button>{!item.builtinKey && <button className="text-red-500" onClick={() => setDeleting(item._id)}>删除</button>}</div>{deleting === item._id && <div className="flex items-center justify-between gap-3 border-t border-zinc-200 dark:border-zinc-700 pt-3 text-sm"><span>确认删除这条{section === "skills" ? "技能" : "记忆"}？</span><button disabled={busy} className="text-red-500" onClick={() => run(async () => { await apiJson(`/api/${section === "skills" ? "skills" : "memories"}/${item._id}`, { method: "DELETE" }); if (section === "skills") setSkills(items => items.filter(skill => skill._id !== item._id)); else setMemories(items => items.filter(memory => memory._id !== item._id)); setDeleting(null); })}>确认删除</button><button onClick={() => setDeleting(null)}>取消</button></div>}</div>)}
      {!(section === "skills" ? skills : memories).length && <p className="py-4 text-center text-sm text-zinc-500">{section === "skills" ? "添加或导入你的第一项技能。" : "还没有保存记忆。"}</p>}
    </>}
  </ChatSettingsDialog>;
}
