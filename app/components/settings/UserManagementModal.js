"use client";

import { useI18n } from '@/lib/client/i18n';
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { Copy, KeyRound, RefreshCw, Search, Trash2, Users, X } from "lucide-react";
import { apiJson } from "@/lib/client/apiClient";
import { useToast } from "../common/ToastProvider";
import ConfirmModal from "../modals/ConfirmModal";

export default function UserManagementModal({ open, onClose }) {
  const { t, formatDate, formatNumber } = useI18n();

  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);

  const [resetResult, setResetResult] = useState(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState(["", ""]);
  const [confirmMessage, setConfirmMessage] = useState(["", ""]);
  const [confirmButtonText, setConfirmButtonText] = useState(["确定", "Confirm"]);
  const [confirmDanger, setConfirmDanger] = useState(false);
  const confirmActionRef = useRef(null);

  const searchTimerRef = useRef(null);
  const requestRef = useRef(null);
  const dialogRef = useRef(null);

  const fetchUsers = useCallback(async (p = 1, q = "") => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p) });
      if (q) params.set("search", q);
      const data = await apiJson(`/api/admin/users?${params}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setUsers(data.users || []);
      setTotal(data.total || 0);
      setPage(data.page || 1);
      setTotalPages(data.totalPages || 1);
    } catch (e) {
      if (!controller.signal.aborted) toast.error(e?.message || ["加载用户列表失败", "Could not load users"]);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [toast]);

  const initializeOpenModal = useEffectEvent(() => {
    setSearch("");
    setPage(1);
    setResetResult(null);
    fetchUsers(1, "");
  });

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      initializeOpenModal();
    }, 0);
    return () => { clearTimeout(timer); clearTimeout(searchTimerRef.current); requestRef.current?.abort(); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event) => {
      if (confirmOpen) return;
      if (event.key === "Escape") { event.preventDefault(); if (!actionLoading) onClose(); }
      if (event.key !== 'Tab') return;
      const controls = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled)')];
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, confirmOpen, actionLoading, onClose]);

  const onSearchChange = (val) => {
    setSearch(val);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setPage(1);
      fetchUsers(1, val.trim());
    }, 400);
  };

  const goPage = (p) => {
    setPage(p);
    fetchUsers(p, search.trim());
  };

  const requestResetPassword = (user) => {
    confirmActionRef.current = async () => {
      setActionLoading(user.id);
      try {
        const data = await apiJson(`/api/admin/users/${user.id}`, {
          method: "PATCH",
          body: { action: "reset-password" },
        });
        setResetResult({ email: user.email, password: data.newPassword });
        toast.success(["密码已重置", "Password reset"]);
      } catch (e) {
        toast.error(e?.message || ["重置密码失败", "Could not reset the password"]);
      } finally {
        setActionLoading(null);
      }
    };
    setConfirmTitle(["重置密码", "Reset password"]);
    setConfirmMessage(["确定重置 {email} 的密码？重置后会生成一个随机密码。", "Reset the password for {email}? A new random password will be generated.", { email: user.email }]);
    setConfirmButtonText(["确认", "Confirm"]);
    setConfirmDanger(false);
    setConfirmOpen(true);
  };

  const requestDeleteUser = (user) => {
    confirmActionRef.current = async () => {
      setActionLoading(user.id);
      try {
        await apiJson(`/api/admin/users/${user.id}`, { method: "DELETE" });
        toast.success(["用户已删除", "User deleted"]);
        if (resetResult?.email === user.email) setResetResult(null);
        await fetchUsers(users.length === 1 && page > 1 ? page - 1 : page, search.trim());
      } catch (e) {
        toast.error(e?.message || ["删除用户失败", "Could not delete the user"]);
      } finally {
        setActionLoading(null);
      }
    };
    setConfirmTitle(["删除用户", "Delete user"]);
    setConfirmMessage(["确定删除 {email}？该用户的对话、设置和文件将永久删除。", "Delete {email}? Their chats, settings, and files will be permanently deleted.", { email: user.email }]);
    setConfirmButtonText(["删除", "Delete"]);
    setConfirmDanger(true);
    setConfirmOpen(true);
  };

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(["已复制到剪贴板", "Copied to clipboard"]);
    } catch {
      toast.error(["复制失败", "Could not copy"]);
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
            onClick={() => { if (!actionLoading && !confirmOpen) onClose(); }}
            role="dialog"
            aria-modal="true"
            aria-label={t("用户管理", "User management")}
          >
            <motion.div
              ref={dialogRef}
              tabIndex={-1}
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl w-full max-w-2xl shadow-pop border border-zinc-200 dark:border-zinc-700 relative max-h-[85dvh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3 p-5 pb-4 border-b border-zinc-100 sm:p-6 sm:pb-4">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <Users size={18} className="text-zinc-600" />
                  <h2 className="text-lg font-semibold text-zinc-900">{t("用户管理", "User management")}</h2>
                  <span className="text-xs text-zinc-500">{t("共 {count} 位用户", "{count} users", { count: formatNumber(total) })}</span>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={Boolean(actionLoading) || confirmOpen}
                  aria-label={t("关闭", "Close")}
                  className="shrink-0 rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 transition-colors disabled:opacity-50"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="px-5 pt-4 pb-2 sm:px-6">
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="text"
                    aria-label={t('搜索邮箱', 'Search by email')}
                    placeholder={t("搜索邮箱…", "Search by email…")}
                    value={search}
                    onChange={(e) => onSearchChange(e.target.value)}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-lg pl-9 pr-3 py-2 text-sm text-zinc-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                  />
                </div>
              </div>

              <AnimatePresence>
                {resetResult && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden px-5 sm:px-6"
                  >
                    <div className="bg-primary/10 border border-primary/30 rounded-lg p-3 flex items-center justify-between gap-2">
                      <div className="min-w-0 break-all text-sm text-zinc-800">
                        <span className="font-medium">{t("{email} 的新密码：", "New password for {email}:", { email: resetResult.email })}</span>
                        <code className="bg-white px-2 py-0.5 rounded text-zinc-900 font-mono ml-1 select-all">
                          {resetResult.password}
                        </code>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => copyToClipboard(resetResult.password)}
                          className="rounded-md p-1.5 text-primary hover:bg-primary/10 transition-colors"
                          title={t("复制密码", "Copy password")}
                          aria-label={t("复制密码", "Copy password")}
                        >
                          <Copy size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setResetResult(null)}
                          className="rounded-md p-1.5 text-primary hover:bg-primary/10 transition-colors"
                          title={t("隐藏新密码", "Hide new password")}
                          aria-label={t("隐藏新密码", "Hide new password")}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex-1 overflow-y-auto fade-scrollbar px-5 py-3 sm:px-6">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <RefreshCw size={20} className="animate-spin motion-reduce:animate-none text-zinc-400" aria-label={t("加载中", "Loading")} />
                  </div>
                ) : users.length === 0 ? (
                  <div className="text-center py-12 text-sm text-zinc-500">
                    {search ? t("没有找到匹配的用户", "No matching users") : t("暂无用户", "No users yet")}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {users.map((u) => (
                      <div
                        key={u.id}
                        className="flex flex-col gap-2 bg-zinc-50 rounded-xl p-3 border border-zinc-100 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="text-sm font-medium text-zinc-800 truncate">{u.email}</div>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${u.isAdmin
                              ? "bg-primary/10 text-primary"
                              : "bg-zinc-200 text-zinc-600"
                              }`}>
                              {u.isAdmin ? t("超级管理员", "Super admin") : t("普通用户", "User")}
                            </span>
                          </div>
                          <div className="text-xs text-zinc-500 mt-0.5">
                            {t("{date} 注册，{count} 个对话", "Joined {date}, {count} chats", { date: u.createdAt ? formatDate(u.createdAt) : "—", count: formatNumber(u.conversationCount) })}
                            <span className="block mt-1">{t("累计花费 {cost}", "Total spent: {cost}", { cost: formatNumber(u.lifetimeCostCny, { style: "currency", currency: "CNY", minimumFractionDigits: 2, maximumFractionDigits: 6 }) })}</span>
                          </div>
                        </div>
                        <div className="flex w-full flex-wrap items-center justify-end gap-1 sm:ml-3 sm:w-auto">
                            {!u.isAdmin ? <button
                              type="button"
                              onClick={() => requestResetPassword(u)}
                              disabled={actionLoading !== null}
                              className="p-2 text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg transition-colors disabled:opacity-50"
                              title={t("重置密码", "Reset password")}
                              aria-label={t("重置密码", "Reset password")}
                            >
                             <KeyRound size={15} />
                           </button> : null}
                            {!u.isAdmin ? <button
                              type="button"
                              onClick={() => requestDeleteUser(u)}
                              disabled={actionLoading !== null}
                              className="p-2 text-zinc-500 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                              title={t("删除用户", "Delete user")}
                              aria-label={t("删除用户", "Delete user")}
                            >
                             <Trash2 size={15} />
                           </button> : null}
                         </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 px-6 py-3 border-t border-zinc-100">
                  <button
                    type="button"
                    onClick={() => goPage(page - 1)}
                    disabled={page <= 1 || loading}
                    className="px-3 py-1.5 text-xs text-zinc-600 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors disabled:opacity-40"
                  >{t("上一页", "Previous")}</button>
                  <span className="text-xs text-zinc-500">
                    {formatNumber(page)} / {formatNumber(totalPages)}
                  </span>
                  <button
                    type="button"
                    onClick={() => goPage(page + 1)}
                    disabled={page >= totalPages || loading}
                    className="px-3 py-1.5 text-xs text-zinc-600 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors disabled:opacity-40"
                  >{t("下一页", "Next")}</button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmModal
        open={confirmOpen}
        onClose={() => {
          setConfirmOpen(false);
          confirmActionRef.current = null;
        }}
        onConfirm={async () => {
          try {
            await confirmActionRef.current?.();
          } finally {
            confirmActionRef.current = null;
            setConfirmOpen(false);
          }
        }}
        title={t(...confirmTitle)}
        message={t(...confirmMessage)}
        confirmText={t(...confirmButtonText)}
        cancelText={t("取消", "Cancel")}
        danger={confirmDanger}
      />
    </>,
    document.body,
  );
}
