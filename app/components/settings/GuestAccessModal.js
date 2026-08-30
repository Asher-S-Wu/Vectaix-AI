"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Link2, Loader2, Pencil, Plus, Power, RefreshCw, Trash2, X } from "lucide-react";
import { apiJson } from "@/lib/client/apiClient";
import { GUEST_MODEL_CATALOG, getGuestModels } from "@/lib/shared/guestModels";
import ConfirmModal from "../modals/ConfirmModal";
import { useToast } from "../common/ToastProvider";

const GROUPS = [
  { type: "chat", name: "聊天" },
  { type: "image", name: "图片" },
  { type: "video", name: "视频" },
  { type: "audio", name: "语音" },
];
const ACTION_CLASS = "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 disabled:opacity-40";

export default function GuestAccessModal({ open, onClose }) {
  const toast = useToast();
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);
  const [share, setShare] = useState(null);
  const [confirmation, setConfirmation] = useState(null);

  const loadLinks = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await apiJson("/api/admin/guest-links");
      setLinks(result.links);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      setDraft(null);
      setShare(null);
      setConfirmation(null);
      loadLinks();
    }, 0);
    return () => clearTimeout(timer);
  }, [open, loadLinks]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !busy && !confirmation) {
        event.stopPropagation();
        if (draft) setDraft(null);
        else onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, busy, confirmation, draft, onClose]);

  const copyUrl = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("私链已复制");
    } catch {
      toast.error("未能复制，请选中链接手动复制");
    }
  };

  const save = async (event) => {
    event.preventDefault();
    if (busy || !draft.name.trim() || draft.allowedModelIds.length === 0) return;
    setBusy(true);
    try {
      const result = await apiJson(draft.id ? `/api/admin/guest-links/${draft.id}` : "/api/admin/guest-links", {
        method: draft.id ? "PATCH" : "POST",
        body: { name: draft.name.trim(), allowedModelIds: draft.allowedModelIds },
      });
      if (result.url) setShare({ name: result.link.name, url: new URL(result.url, window.location.origin).href });
      setDraft(null);
      toast.success(draft.id ? "访问权限已更新" : "游客私链已创建");
      await loadLinks();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const revealLink = async (link) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await apiJson(`/api/admin/guest-links/${link.id}/link`);
      const url = new URL(result.url, window.location.origin).href;
      setShare({ name: link.name, url });
      await copyUrl(url);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const performAction = async () => {
    if (!confirmation || busy) return;
    setBusy(true);
    const { action, link } = confirmation;
    try {
      if (action === "delete") {
        await apiJson(`/api/admin/guest-links/${link.id}`, { method: "DELETE" });
        setShare(null);
        toast.success("私链及共享数据已删除");
      } else if (action === "reset") {
        const result = await apiJson(`/api/admin/guest-links/${link.id}/link`, { method: "POST" });
        setShare({ name: link.name, url: new URL(result.url, window.location.origin).href });
        toast.success("已生成新私链，旧链接已失效");
      } else {
        await apiJson(`/api/admin/guest-links/${link.id}`, {
          method: "PATCH", body: { enabled: !link.enabled },
        });
        toast.success(link.enabled ? "私链已停用" : "私链已启用");
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      await loadLinks();
      setConfirmation(null);
      setBusy(false);
    }
  };

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-3 backdrop-blur-sm sm:p-6"
            role="dialog" aria-modal="true" aria-label="游客访问"
            onClick={() => { if (!busy && !confirmation) onClose(); }}>
            <motion.div initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-pop dark:border-zinc-700 dark:bg-zinc-900"
              onClick={(event) => event.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
                <div className="flex items-center gap-2.5">
                  <Link2 size={20} className="text-primary" />
                  <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">游客访问</h2>
                </div>
                <button type="button" onClick={onClose} disabled={busy} className={ACTION_CLASS} aria-label="关闭游客访问"><X size={18} /></button>
              </div>
              <div className="space-y-4 overflow-y-auto px-5 py-5 fade-scrollbar">
                <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">持有私链的人无需登录即可使用。每条私链有独立的共享空间，同一链接的访客可以查看和修改彼此的记录，请只分享给信任的人。</p>
                {share && (
                  <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/40">
                    <div className="flex items-center justify-between gap-2 text-sm font-medium text-emerald-800 dark:text-emerald-300">
                      <span className="truncate">{share.name} · 私链</span>
                      <button type="button" onClick={() => setShare(null)} aria-label="收起私链" className="p-1"><X size={15} /></button>
                    </div>
                    <div className="flex gap-2">
                      <input aria-label="游客私链" readOnly value={share.url} onFocus={(event) => event.target.select()}
                        className="min-w-0 flex-1 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs text-zinc-700 dark:border-emerald-800 dark:bg-zinc-900 dark:text-zinc-200" />
                      <button type="button" onClick={() => copyUrl(share.url)} className={ACTION_CLASS}><Copy size={14} />复制</button>
                    </div>
                  </div>
                )}
                {draft ? (
                  <form onSubmit={save} className="space-y-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
                    <h3 className="font-medium text-zinc-900 dark:text-zinc-100">{draft.id ? "修改游客访问" : "创建游客私链"}</h3>
                    <label className="block space-y-1.5 text-sm text-zinc-600 dark:text-zinc-300">
                      <span>名称</span>
                      <input autoFocus value={draft.name} maxLength={80} required disabled={busy} placeholder="例如：朋友体验、团队试用"
                        onChange={(event) => setDraft((previous) => ({ ...previous, name: event.target.value }))}
                        className="w-full rounded-lg border border-zinc-200 bg-transparent px-3 py-2.5 text-zinc-900 outline-none focus:border-primary dark:border-zinc-700 dark:text-zinc-100" />
                    </label>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-sm"><span className="text-zinc-600 dark:text-zinc-300">允许使用的模型</span><span className="text-xs text-zinc-400">已选 {draft.allowedModelIds.length} 个</span></div>
                      {GROUPS.map((group) => (
                        <fieldset key={group.type}>
                          <legend className="mb-2 text-xs font-medium text-zinc-400">{group.name}</legend>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {GUEST_MODEL_CATALOG.filter((model) => model.type === group.type).map((model) => {
                              const selected = draft.allowedModelIds.includes(model.id);
                              return (
                                <label key={model.id} className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors ${selected ? "border-primary/40 bg-primary/5 text-zinc-900 dark:text-zinc-100" : "border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"}`}>
                                  <input type="checkbox" checked={selected} disabled={busy} className="accent-primary"
                                    onChange={() => setDraft((previous) => ({ ...previous, allowedModelIds: selected ? previous.allowedModelIds.filter((id) => id !== model.id) : [...previous.allowedModelIds, model.id] }))} />
                                  <span>{model.name}</span>
                                </label>
                              );
                            })}
                          </div>
                        </fieldset>
                      ))}
                    </div>
                    <p className="text-xs leading-5 text-zinc-400">只选择一个模型时，访客会直接进入对应工作台。链接长期有效，可随时手动停用；不设使用额度。</p>
                    <div className="flex justify-end gap-2">
                      <button type="button" disabled={busy} onClick={() => setDraft(null)} className={ACTION_CLASS}>取消</button>
                      <button type="submit" disabled={busy || !draft.name.trim() || !draft.allowedModelIds.length}
                        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
                        {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}{draft.id ? "保存修改" : "创建私链"}
                      </button>
                    </div>
                  </form>
                ) : (
                  <button type="button" disabled={busy || loading} onClick={() => setDraft({ name: "", allowedModelIds: [] })}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"><Plus size={16} />创建私链</button>
                )}
                {error ? (
                  <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-300">{error}<button type="button" onClick={loadLinks} className="ml-3 underline">重新加载</button></div>
                ) : loading ? (
                  <div className="flex justify-center py-8" aria-label="正在加载私链"><Loader2 size={20} className="animate-spin text-zinc-400" /></div>
                ) : links.length === 0 ? (
                  <div className="py-8 text-center text-sm text-zinc-400">还没有游客私链</div>
                ) : (
                  <div className="space-y-3">
                    {links.map((link) => (
                      <div key={link.id} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="break-all text-sm font-semibold text-zinc-900 dark:text-zinc-100">{link.name}</h3>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${link.enabled ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"}`}>{link.deletionInProgress ? "等待完成清理" : link.enabled ? "已启用" : "已停用"}</span>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{getGuestModels(link.allowedModelIds).map((model) => model.name).join(" · ")}</p>
                        <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-zinc-100 pt-2 dark:border-zinc-800">
                          <button type="button" disabled={busy || link.deletionInProgress} onClick={() => revealLink(link)} className={ACTION_CLASS}><Copy size={13} />复制私链</button>
                          <button type="button" disabled={busy || link.deletionInProgress} onClick={() => setDraft({ id: link.id, name: link.name, allowedModelIds: [...link.allowedModelIds] })} className={ACTION_CLASS}><Pencil size={13} />修改权限</button>
                          <button type="button" disabled={busy || link.deletionInProgress} onClick={() => setConfirmation({ action: "toggle", link })} className={ACTION_CLASS}><Power size={13} />{link.enabled ? "停用" : "启用"}</button>
                          <button type="button" disabled={busy || link.deletionInProgress} onClick={() => setConfirmation({ action: "reset", link })} className={ACTION_CLASS}><RefreshCw size={13} />重置私链</button>
                          <button type="button" disabled={busy} onClick={() => setConfirmation({ action: "delete", link })} className={`${ACTION_CLASS} text-red-500 dark:text-red-400`}><Trash2 size={13} />{link.deletionInProgress ? "继续删除" : "删除"}</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <ConfirmModal open={Boolean(confirmation)} onClose={() => setConfirmation(null)} onConfirm={performAction}
        title={confirmation?.action === "delete" ? "删除私链和共享数据" : confirmation?.action === "reset" ? "重置游客私链" : confirmation?.link.enabled ? "停用游客私链" : "启用游客私链"}
        message={confirmation?.action === "delete" ? `“${confirmation.link.name}”中的聊天、作品、文件和音色将永久删除，所有访客将无法再访问。此操作不可撤销。` : confirmation?.action === "reset" ? "重置后原链接和已打开的访问会话都会失效，共享记录保留。请将新链接发给需要访问的人。" : confirmation?.link.enabled ? "停用后所有访客将无法继续访问，共享记录保留。已提交的生成任务可能仍会完成。" : "启用后，持有原私链的访客可以再次访问共享空间。"}
        confirmText={confirmation?.action === "delete" ? "永久删除" : "确认"} danger={confirmation?.action === "delete"} />
    </>
  );
}
