"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Download, FileText, Trash2, Upload, X, ExternalLink } from "lucide-react";
import { apiJson, apiRequest } from "@/lib/client/apiClient";
import { buttonClass } from "./ChatSettingsDialog";

export default function ChatResourcesPanel(props) {
  if (!props.open) return null;
  return <ResourcesContent key={`${props.conversationId}:${props.projectId}`} {...props} />;
}

function ResourcesContent({ onClose, conversationId, projectId, tasks = [] }) {
  const [tab, setTab] = useState("files");
  const [files, setFiles] = useState([]);
  const [projectFiles, setProjectFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(null);
  const uploadRef = useRef(null);
  const scopeRef = useRef("conversation");
  const latestTaskId = tasks.find(task => task.conversationId === conversationId)?._id;
  useEffect(() => {
    let disposed = false;
    Promise.all([...(conversationId ? [apiJson(`/api/conversations/${conversationId}/files`).then(result => { if (!disposed) setFiles(result.files.filter(file => file.ownerType === "conversation" && file.ownerId === conversationId)); })] : []), ...(projectId ? [apiJson(`/api/projects/${projectId}/files`).then(result => { if (!disposed) setProjectFiles(result.files.filter(file => file.ownerType === "project" && file.ownerId === projectId)); })] : [])]).catch(failure => { if (!disposed) setError(failure.message); }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [conversationId, projectId, latestTaskId]);
  useEffect(() => {
    const closeOnEscape = event => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  const run = async action => { setError(""); setBusy(true); try { await action(); } catch (failure) { setError(failure.message); } finally { setBusy(false); } };
  const upload = event => {
    const file = event.target.files[0]; event.target.value = ""; if (!file) return;
    const scope = scopeRef.current;
    run(async () => { const body = new FormData(); body.append("file", file); const result = await apiRequest(scope === "project" ? `/api/projects/${projectId}/files` : `/api/conversations/${conversationId}/files`, { method: "POST", body }); if (scope === "project") setProjectFiles(items => [result.file, ...items]); else setFiles(items => [{ ...result.file, ownerType: "conversation", ownerId: conversationId }, ...items]); });
  };
  const fileList = (items, scope) => items.map(file => {
    const canDelete = scope === "project" || (file.ownerType === "conversation" && file.ownerId === conversationId);
    return <div key={file.fileId} className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-3"><div className="flex items-center gap-2"><FileText size={17} className="shrink-0 text-primary" /><a href={file.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1"><span className="block truncate text-sm">{file.name}</span><span className="text-xs text-zinc-400">{(file.size / 1024).toFixed(1)} KB</span></a>{canDelete && <button disabled={busy} aria-label={`删除 ${file.name}`} className="p-1.5 text-zinc-400 hover:text-red-500" onClick={() => setDeleting(file.fileId)}><Trash2 size={14} /></button>}</div>{deleting === file.fileId && <div className="mt-3 flex gap-3 text-xs"><span>确认删除？</span><button disabled={busy} className="text-red-500" onClick={() => run(async () => { if (scope === "project") { await apiJson(`/api/projects/${projectId}/files/${file.fileId}`, { method: "DELETE" }); setProjectFiles(items => items.filter(item => item.fileId !== file.fileId)); } else { await apiJson(`/api/conversations/${conversationId}/files`, { method: "DELETE", body: { fileId: file.fileId } }); setFiles(items => items.filter(item => item.fileId !== file.fileId)); } setDeleting(null); })}>删除</button><button onClick={() => setDeleting(null)}>取消</button></div>}</div>;
  });
  const conversationTasks = tasks.filter(task => task.conversationId === conversationId);
  const artifacts = conversationTasks.flatMap(task => task.artifacts || []);
  const citations = conversationTasks.flatMap(task => task.citations || []);
  return <><button className="fixed inset-0 z-[59] bg-black/30 lg:hidden" aria-label="关闭资料栏" onClick={onClose} /><aside role="complementary" aria-label="对话资料与成果" className="fixed inset-y-0 right-0 z-[60] flex w-80 max-w-[90vw] flex-col border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl lg:relative lg:z-20 lg:shadow-none shrink-0"><div className="flex items-center justify-between p-4 border-b border-zinc-100 dark:border-zinc-800"><h2 className="font-semibold text-sm">资料与成果</h2><button onClick={onClose} aria-label="关闭资料栏" className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"><X size={17} /></button></div><div role="tablist" aria-label="资料分类" className="grid grid-cols-2 gap-1 p-3">{[{ id: "files", label: "资料" }, { id: "results", label: "成果与引用" }].map(item => <button key={item.id} role="tab" aria-selected={tab === item.id} className={`rounded-lg py-2 text-sm ${tab === item.id ? "bg-primary/10 text-primary" : "text-zinc-500"}`} onClick={() => setTab(item.id)}>{item.label}</button>)}</div><div className="flex-1 overflow-y-auto px-4 pb-5 space-y-4 text-zinc-700 dark:text-zinc-200">
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    <input type="file" ref={uploadRef} hidden onChange={upload} accept=".pdf,.docx,.xlsx,.csv,.txt,.md,.jpg,.jpeg,.png,.gif,.webp,.bmp,.tif,.tiff,.mp3,.wav,.m4a,.aac,.ogg,.weba,.mp4,.mov,.webm,.m4v" />
    {tab === "files" ? <>{loading ? <p className="text-sm text-zinc-500">正在加载资料…</p> : <>{[{ scope: "conversation", title: "当前对话", id: conversationId, items: files }, { scope: "project", title: "项目共享资料", id: projectId, items: projectFiles }].map(({ scope, title, id, items }) => <section key={scope} className="space-y-3"><h3 className="text-xs font-semibold text-zinc-500 pt-2">{title}</h3>{id ? <><button className={`${buttonClass} w-full`} disabled={busy} onClick={() => { scopeRef.current = scope; uploadRef.current.click(); }}><Upload size={15} />{busy ? "处理中…" : "上传文件"}</button>{fileList(items, scope)}{!items.length && <p className="text-xs text-zinc-400 py-2">还没有文件</p>}</> : <p className="text-xs text-zinc-400 leading-relaxed">{scope === "conversation" ? "开始对话后，可在这里上传和管理资料。" : "将对话加入项目，即可共享项目资料。"}</p>}</section>)}<p className="text-xs text-zinc-400">支持文档、表格、图片、音频和视频，单个文件不超过 20 MB。</p></>}</> : <>{!artifacts.length && <p className="py-6 text-center text-sm text-zinc-500">对话中生成的文件会显示在这里。</p>}{artifacts.map((file, index) => <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700" key={`${file.fileId}:${index}`}>{file.mimeType?.startsWith("image/") && <Image src={file.url} alt={file.name} width={600} height={450} unoptimized className="w-full h-auto" />}{file.mimeType?.startsWith("video/") && <video src={file.url} controls preload="metadata" className="w-full" />}{file.mimeType?.startsWith("audio/") && <audio src={file.url} controls preload="metadata" className="w-full" />}<a href={file.url} download={file.name} target="_blank" rel="noreferrer" className="flex items-center gap-2 p-3 text-sm"><Download size={15} className="shrink-0" /><span className="truncate">{file.name}</span></a></div>)}{citations.length > 0 && <section className="space-y-3"><h3 className="text-xs font-semibold text-zinc-500">引用来源</h3>{citations.map((source, index) => <a key={`${source.url}:${index}`} href={source.url} target="_blank" rel="noreferrer" className="flex items-start gap-2 text-sm text-primary"><span>{index + 1}.</span><span className="min-w-0 flex-1 break-words">{source.title || source.url}</span><ExternalLink size={13} className="mt-1 shrink-0" /></a>)}</section>}</>}
  </div></aside></>;
}
