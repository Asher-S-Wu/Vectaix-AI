"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Coins, Copy, KeyRound, RefreshCw, Search, Settings2, Sparkles, Trash2, Users, X } from "lucide-react";
import { apiJson } from "@/lib/client/apiClient";
import { useToast } from "../common/ToastProvider";
import ConfirmModal from "../modals/ConfirmModal";
import BillingSettingsPanel from "./BillingSettingsPanel";

export default function UserManagementModal({ open, onClose }) {
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);
  const [activeTab, setActiveTab] = useState("users");
  const [creditEditor, setCreditEditor] = useState(null);
  const [creditSaving, setCreditSaving] = useState(false);

  // 重置密码结果
  const [resetResult, setResetResult] = useState(null);

  // 确认弹窗
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState("");
  const [confirmMessage, setConfirmMessage] = useState("");
  const [confirmButtonText, setConfirmButtonText] = useState("确定");
  const [confirmDanger, setConfirmDanger] = useState(false);
  const confirmActionRef = useRef(null);

  const searchTimerRef = useRef(null);

  const fetchUsers = useCallback(async (p = 1, q = "") => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p) });
      if (q) params.set("search", q);
      const data = await apiJson(`/api/admin/users?${params}`);
      setUsers(data.users || []);
      setTotal(data.total || 0);
      setPage(data.page || 1);
      setTotalPages(data.totalPages || 1);
    } catch (e) {
      toast.error(e?.message || "加载用户列表失败");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const initializeOpenModal = useEffectEvent(() => {
    setSearch("");
    setPage(1);
    setResetResult(null);
    setActiveTab("users");
    setCreditEditor(null);
    fetchUsers(1, "");
  });

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      initializeOpenModal();
    }, 0);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !confirmOpen && !creditEditor) onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, confirmOpen, creditEditor, onClose]);

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

  // 重置密码
  const requestResetPassword = (user) => {
    confirmActionRef.current = async () => {
      setActionLoading(user.id);
      try {
        const data = await apiJson(`/api/admin/users/${user.id}`, {
          method: "PATCH",
          body: { action: "reset-password" },
        });
        setResetResult({ email: user.email, password: data.newPassword });
        toast.success("密码已重置");
      } catch (e) {
        toast.error(e?.message);
      } finally {
        setActionLoading(null);
      }
    };
    setConfirmTitle("重置密码");
    setConfirmMessage(`确定要重置「${user.email}」的密码吗？重置后将生成新的随机密码。`);
    setConfirmButtonText("确认");
    setConfirmDanger(false);
    setConfirmOpen(true);
  };

  // 删除用户
  const requestDeleteUser = (user) => {
    confirmActionRef.current = async () => {
      setActionLoading(user.id);
      try {
        await apiJson(`/api/admin/users/${user.id}`, { method: "DELETE" });
        toast.success("用户已删除");
        fetchUsers(page, search.trim());
      } catch (e) {
        toast.error(e?.message);
      } finally {
        setActionLoading(null);
      }
    };
    setConfirmTitle("删除用户");
    setConfirmMessage(`确定要删除「${user.email}」吗？该用户的所有数据（对话、设置、文件）将被永久删除，此操作不可撤销。`);
    setConfirmButtonText("删除");
    setConfirmDanger(true);
    setConfirmOpen(true);
  };

  const requestToggleAdvancedUser = (user) => {
    const nextIsAdvancedUser = !user.isAdvancedUser;
    confirmActionRef.current = async () => {
      setActionLoading(user.id);
      try {
        await apiJson(`/api/admin/users/${user.id}`, {
          method: "PATCH",
          body: {
            action: "set-advanced-user",
            isAdvancedUser: nextIsAdvancedUser,
          },
        });
        toast.success(nextIsAdvancedUser ? "已升级为高级用户" : "已降为普通用户");
        fetchUsers(page, search.trim());
      } catch (e) {
        toast.error(e?.message);
      } finally {
        setActionLoading(null);
      }
    };
    setConfirmTitle(nextIsAdvancedUser ? "升级高级用户" : "降为普通用户");
    setConfirmMessage(
      nextIsAdvancedUser
        ? `确定要把「${user.email}」升级为高级用户吗？升级后，这个用户可以自己切换线路，而且只影响自己的账号。`
        : `确定要把「${user.email}」降为普通用户吗？降级后，这个用户将不能再切换线路，并恢复为普通线路。`
    );
    setConfirmButtonText(nextIsAdvancedUser ? "升级" : "降级");
    setConfirmDanger(false);
    setConfirmOpen(true);
  };

  const openCreditEditor = (user) => {
    setCreditEditor({
      user,
      availablePoints: String(user.availablePoints || 0),
      reason: "",
    });
  };

  const saveCreditBalance = async () => {
    if (!creditEditor) return;
    const availablePoints = Number(creditEditor.availablePoints);
    if (!Number.isSafeInteger(availablePoints) || availablePoints < 0) {
      toast.warning("积分必须是大于或等于 0 的整数");
      return;
    }
    if (!creditEditor.reason.trim()) {
      toast.warning("请填写本次调整原因");
      return;
    }
    setCreditSaving(true);
    try {
      const payload = await apiJson(`/api/admin/users/${creditEditor.user.id}/credits`, {
        method: "PATCH",
        body: {
          operationId: crypto.randomUUID(),
          availablePoints,
          reason: creditEditor.reason.trim(),
        },
      });
      setUsers((current) => current.map((user) => (
        user.id === creditEditor.user.id
          ? { ...user, availablePoints: payload.targetCredit?.availablePoints ?? availablePoints }
          : user
      )));
      setCreditEditor(null);
      toast.success("用户积分已更新");
    } catch (error) {
      toast.error(error?.message || "设置用户积分失败");
    } finally {
      setCreditSaving(false);
    }
  };

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("已复制到剪贴板");
    } catch {
      toast.error("复制失败");
    }
  };

  const formatDate = (d) => {
    if (!d) return "-";
    return new Date(d).toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  };

  const getUserLevelLabel = (user) => {
    if (user?.isAdmin) return "超级管理员";
    if (user?.isAdvancedUser) return "高级用户";
    return "普通用户";
  };

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-label="用户管理"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl w-full max-w-2xl shadow-pop border border-zinc-200 dark:border-zinc-700 relative max-h-[85vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* 头部 */}
              <div className="flex items-center justify-between p-6 pb-4 border-b border-zinc-100 dark:border-zinc-800">
                <div className="flex items-center gap-2">
                  <Users size={18} className="text-zinc-600 dark:text-zinc-400" />
                  <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">用户管理</h2>
                  <span className="text-xs text-zinc-400 ml-1">共 {total} 位用户</span>
                </div>
                <button
                  onClick={onClose}
                  className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-1 border-b border-zinc-100 bg-zinc-50 p-1.5 dark:border-zinc-800 dark:bg-zinc-900">
                <button
                  type="button"
                  onClick={() => setActiveTab("users")}
                  className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${activeTab === "users" ? "bg-white text-primary shadow-sm dark:bg-zinc-800" : "text-zinc-500"}`}
                >
                  <Users size={15} /> 用户与余额
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("billing")}
                  className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${activeTab === "billing" ? "bg-white text-primary shadow-sm dark:bg-zinc-800" : "text-zinc-500"}`}
                >
                  <Settings2 size={15} /> 积分与费率
                </button>
              </div>

              {activeTab === "users" ? <>
              {/* 搜索栏 */}
              <div className="px-6 pt-4 pb-2">
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="text"
                    placeholder="搜索邮箱…"
                    value={search}
                    onChange={(e) => onSearchChange(e.target.value)}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-lg pl-9 pr-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  />
                </div>
              </div>

              {/* 重置密码结果 */}
              <AnimatePresence>
                {resetResult && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden px-6"
                  >
                    <div className="bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700 rounded-lg p-3 flex items-center justify-between gap-2">
                      <div className="text-sm text-emerald-800 dark:text-emerald-300">
                        <span className="font-medium">{resetResult.email}</span> 的新密码：
                        <code className="bg-emerald-100 dark:bg-emerald-800/50 px-2 py-0.5 rounded text-emerald-900 dark:text-emerald-200 font-mono ml-1">
                          {resetResult.password}
                        </code>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => copyToClipboard(resetResult.password)}
                          className="p-1.5 text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-200 transition-colors"
                          title="复制密码"
                        >
                          <Copy size={14} />
                        </button>
                        <button
                          onClick={() => setResetResult(null)}
                          className="p-1.5 text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-200 transition-colors"
                          title="关闭"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* 用户列表 */}
              <div className="flex-1 overflow-y-auto fade-scrollbar px-6 py-3">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <RefreshCw size={20} className="animate-spin text-zinc-400" />
                  </div>
                ) : users.length === 0 ? (
                  <div className="text-center py-12 text-sm text-zinc-400">
                    {search ? "没有找到匹配的用户" : "暂无用户"}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {users.map((u) => (
                      <div
                        key={u.id}
                        className="flex flex-col gap-2 bg-zinc-50 rounded-xl p-3 border border-zinc-100 hover:border-zinc-200 transition-colors sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">{u.email}</div>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${u.isAdmin
                              ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400"
                              : u.isAdvancedUser
                                ? "bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-400"
                                : "bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400"
                              }`}>
                              {getUserLevelLabel(u)}
                            </span>
                          </div>
                          <div className="text-xs text-zinc-400 mt-0.5">
                            注册于 {formatDate(u.createdAt)} · {u.conversationCount} 个对话
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                            <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-300">
                              <Coins size={12} /> {u.isAdmin ? "无限积分" : `${Number(u.availablePoints || 0).toLocaleString("zh-CN")} 可用`}
                            </span>
                            {!u.isAdmin && Number(u.heldPoints || 0) > 0 ? <span>冻结 {Number(u.heldPoints).toLocaleString("zh-CN")}</span> : null}
                            <span>
                              累计计费 {Number(u.lifetimeSpentPoints || 0).toLocaleString("zh-CN")} 积分
                            </span>
                          </div>
                        </div>
                        <div className="flex w-full flex-wrap items-center justify-end gap-1 sm:ml-3 sm:w-auto">
                            {!u.isAdmin ? (
                              <button
                                onClick={() => openCreditEditor(u)}
                                disabled={actionLoading !== null}
                                className="p-2 text-zinc-400 hover:bg-amber-50 hover:text-amber-600 rounded-lg transition-colors disabled:opacity-50"
                                title="设置积分"
                                aria-label={`设置 ${u.email} 的积分`}
                              >
                                <Coins size={15} />
                              </button>
                            ) : null}
                            {!u.isAdmin && (
                              <button
                                onClick={() => requestToggleAdvancedUser(u)}
                                disabled={actionLoading !== null}
                                className={`p-2 rounded-lg transition-colors disabled:opacity-50 inline-flex items-center justify-center ${u.isAdvancedUser
                                  ? "text-zinc-400 hover:text-amber-600 hover:bg-amber-50"
                                  : "text-zinc-400 hover:text-sky-600 hover:bg-sky-50"
                                  }`}
                                title={u.isAdvancedUser ? "降为普通用户" : "升级为高级用户"}
                                aria-label={u.isAdvancedUser ? "降为普通用户" : "升级为高级用户"}
                              >
                                <Sparkles size={15} className="shrink-0" />
                              </button>
                            )}
                            {!u.isAdmin ? <button
                              onClick={() => requestResetPassword(u)}
                              disabled={actionLoading !== null}
                              className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 rounded-lg transition-colors disabled:opacity-50"
                              title="重置密码"
                            >
                             <KeyRound size={15} />
                           </button> : null}
                            {!u.isAdmin ? <button
                              onClick={() => requestDeleteUser(u)}
                              disabled={actionLoading !== null}
                              className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                              title="删除用户"
                            >
                             <Trash2 size={15} />
                           </button> : null}
                         </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 分页 */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 px-6 py-3 border-t border-zinc-100 dark:border-zinc-800">
                  <button
                    onClick={() => goPage(page - 1)}
                    disabled={page <= 1 || loading}
                    className="px-3 py-1.5 text-xs text-zinc-600 dark:text-zinc-400 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors disabled:opacity-40"
                  >
                    上一页
                  </button>
                  <span className="text-xs text-zinc-500">
                    {page} / {totalPages}
                  </span>
                  <button
                    onClick={() => goPage(page + 1)}
                    disabled={page >= totalPages || loading}
                    className="px-3 py-1.5 text-xs text-zinc-600 dark:text-zinc-400 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors disabled:opacity-40"
                  >
                    下一页
                  </button>
                </div>
              )}
              </> : (
                <div className="flex-1 overflow-y-auto fade-scrollbar px-5 py-4">
                  <BillingSettingsPanel active={activeTab === "billing"} />
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {creditEditor ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[65] flex items-end justify-center bg-black/45 p-0 backdrop-blur-sm sm:items-center sm:p-4"
            onClick={() => setCreditEditor(null)}
            role="dialog"
            aria-modal="true"
            aria-label="设置用户积分"
          >
            <motion.div
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0 }}
              className="w-full max-w-md rounded-t-3xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950 sm:rounded-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">设置可用积分</h3>
                  <p className="mt-0.5 truncate text-xs text-zinc-500">{creditEditor.user.email}</p>
                </div>
                <button type="button" onClick={() => setCreditEditor(null)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="关闭">
                  <X size={18} />
                </button>
              </div>
              <label className="mt-4 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                目标可用积分
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={creditEditor.availablePoints}
                  onChange={(event) => setCreditEditor((current) => ({ ...current, availablePoints: event.target.value }))}
                  className="mt-1.5 h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-primary dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>
              <label className="mt-3 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                调整原因
                <textarea
                  value={creditEditor.reason}
                  onChange={(event) => setCreditEditor((current) => ({ ...current, reason: event.target.value }))}
                  maxLength={200}
                  rows={3}
                  placeholder="例如：补发活动积分"
                  className="mt-1.5 w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-primary dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>
              <p className="mt-2 text-xs text-zinc-400">正在冻结的积分不会被本次设置覆盖。</p>
              <button
                type="button"
                onClick={saveCreditBalance}
                disabled={creditSaving}
                className="btn-primary mt-4 w-full rounded-xl py-2.5 text-sm font-medium disabled:opacity-50"
              >
                {creditSaving ? "保存中…" : "保存积分"}
              </button>
            </motion.div>
          </motion.div>
        ) : null}
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
        title={confirmTitle}
        message={confirmMessage}
        confirmText={confirmButtonText}
        cancelText="取消"
        danger={confirmDanger}
      />
    </>
  );
}
