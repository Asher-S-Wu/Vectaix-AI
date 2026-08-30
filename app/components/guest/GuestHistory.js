"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import NextImage from "next/image";
import { Download, Loader2, Trash2, X } from "lucide-react";
import { apiJson } from "@/lib/client/apiClient";
import { guestWorkspaceHref, scopeGuestUrl } from "@/lib/client/guestAccess";
import ConfirmModal from "@/app/components/modals/ConfirmModal";

const CATEGORIES = [{ id: "chat", label: "聊天" }, { id: "image", label: "图片" }, { id: "video", label: "视频" }, { id: "audio", label: "音频" }];

export default function GuestHistory({ onClose }) {
  const requestSequence = useRef(0);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [category, setCategory] = useState("chat");
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError("");
    try {
      const result = await apiJson(`/api/guest/history?category=${category}&page=${page}`);
      if (sequence === requestSequence.current) setData(result);
    } catch (reason) {
      if (sequence === requestSequence.current) setError(reason.message || "读取记录失败");
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [category, page]);
  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => { clearTimeout(timer); requestSequence.current += 1; };
  }, [load, refreshVersion]);
  useEffect(() => {
    const close = (event) => { if (event.key === "Escape" && !deleteTarget) onClose(); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose, deleteTarget]);
  const remove = async () => {
    const item = deleteTarget;
    setDeleteTarget(null);
    if (!item) return;
    setDeleting(item.id);
    try { await apiJson(item.deleteUrl, { method: "DELETE" }); setRefreshVersion((value) => value + 1); }
    catch (reason) { setError(reason.message || "删除记录失败"); }
    finally { setDeleting(""); }
  };
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal="true" aria-label="共享历史记录">
    <section className="flex max-h-[88dvh] w-full max-w-3xl flex-col rounded-2xl border border-zinc-200 bg-white p-5 shadow-pop dark:border-zinc-700 dark:bg-zinc-900" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">共享历史记录</h2><p className="mt-1 text-xs text-zinc-500">持有此链接的人可查看这些内容；模型权限调整不会移除已有记录。</p></div><button type="button" onClick={onClose} aria-label="关闭历史记录" className="rounded-lg p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X size={18} /></button></div>
      <div className="my-4 flex gap-2">{CATEGORIES.map((item) => <button key={item.id} type="button" onClick={() => { setCategory(item.id); setPage(1); }} className={`rounded-lg px-4 py-2 text-sm ${category === item.id ? "bg-primary text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}>{item.label}</button>)}</div>
      <div className="min-h-48 space-y-3 overflow-y-auto fade-scrollbar">
        {loading ? <div className="flex justify-center py-12"><Loader2 className="animate-spin" /></div> : error ? <p className="p-6 text-sm text-red-500">{error}</p> : data.items.length === 0 ? <p className="py-12 text-center text-sm text-zinc-500">暂无记录</p> : data.items.map((item) => <article key={`${item.type}:${item.id}`} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate text-sm font-medium">{item.title || "未命名记录"}</h3><p className="mt-1 text-xs text-zinc-500">{new Date(item.createdAt).toLocaleString("zh-CN")}{item.status ? ` · ${["COMPLETED", "SUCCEEDED", "SUCCESS"].includes(String(item.status).toUpperCase()) ? "已完成" : String(item.status).toUpperCase() === "FAILED" ? "失败" : "处理中"}` : ""}</p></div><div className="flex shrink-0 gap-2">{item.url && <a href={scopeGuestUrl(`${item.url}${item.url.includes("?") ? "&" : "?"}download=1`)} target="_blank" rel="noreferrer" title="下载" className="rounded-lg p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"><Download size={16} /></a>}<button type="button" title="删除" onClick={() => setDeleteTarget(item)} disabled={Boolean(deleting)} className="rounded-lg p-2 text-red-500 hover:bg-red-50 disabled:opacity-40 dark:hover:bg-red-950"><Trash2 size={16} /></button></div></div>
          {category === "chat" ? <Link onClick={onClose} href={`${guestWorkspaceHref("/")}?conversation=${encodeURIComponent(item.conversationId || item.id)}`} className="mt-3 inline-block text-sm text-primary">打开对话</Link> : item.url && category === "image" ? <a href={scopeGuestUrl(item.url)} target="_blank" rel="noreferrer"><NextImage src={scopeGuestUrl(item.url)} alt={item.title || "历史图片"} width={800} height={800} unoptimized className="mt-3 h-auto max-h-64 w-auto rounded-lg object-contain" /></a> : item.url && category === "audio" ? <audio src={scopeGuestUrl(item.url)} controls preload="metadata" className="mt-3 w-full" /> : item.url && category === "video" ? <video src={scopeGuestUrl(item.url)} controls preload="metadata" className="mt-3 max-h-72 w-full rounded-lg" /> : null}
        </article>)}
      </div>
      <div className="mt-4 flex items-center justify-between text-sm text-zinc-500"><span>共 {data.total} 条</span><div className="flex items-center gap-3"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)} className="disabled:opacity-30">上一页</button><span>{page} / {Math.max(1, data.totalPages)}</span><button type="button" disabled={page >= data.totalPages || loading} onClick={() => setPage((value) => value + 1)} className="disabled:opacity-30">下一页</button></div></div>
    </section>
    <ConfirmModal open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} onConfirm={remove} title="删除共享记录" message="删除后，持有此链接的人都将无法再查看这条记录。" confirmText="删除" danger />
  </div>;
}
