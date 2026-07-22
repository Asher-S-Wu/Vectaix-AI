"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Copy, KeyRound, RefreshCw, Search, Sparkles, Trash2, Users, X } from "lucide-react";
import { apiJson } from "@/lib/client/apiClient";
import { useToast } from "../common/ToastProvider";
import ConfirmModal from "../modals/ConfirmModal";

export default function UserManagementModal({ open, onClose }) {
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);

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

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      setSearch("");
      setPage(1);
      setResetResult(null);
      fetchUsers(1, "");
    }, 0);
    return () => clearTimeout(timer);
  }, [open, fetchUsers]);

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
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4"
            onClick={onClose}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-2xl shadow-pop border border-zinc-200 dark:border-zinc-700 relative max-h-[85vh] flex flex-col"
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

              {/* 搜索栏 */}
              <div className="px-6 pt-4 pb-2">
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="text"
                    placeholder="搜索邮箱…"
                    value={search}
                    onChange={(e) => onSearchChange(e.target.value)}
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg pl-9 pr-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 focus:border-zinc-400 outline-none"
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
                        className="flex items-center justify-between bg-zinc-50 dark:bg-zinc-800 rounded-xl p-3 border border-zinc-100 dark:border-zinc-700 hover:border-zinc-200 dark:hover:border-zinc-600 transition-colors"
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
                        </div>
                        <div className="flex items-center gap-1 ml-3">
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
                            <button
                              onClick={() => requestResetPassword(u)}
                              disabled={actionLoading !== null}
                              className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors disabled:opacity-50"
                              title="重置密码"
                            >
                             <KeyRound size={15} />
                           </button>
                            <button
                              onClick={() => requestDeleteUser(u)}
                              disabled={actionLoading !== null}
                              className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                              title="删除用户"
                            >
                             <Trash2 size={15} />
                           </button>
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
                    className="px-3 py-1.5 text-xs text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors disabled:opacity-40"
                  >
                    上一页
                  </button>
                  <span className="text-xs text-zinc-500">
                    {page} / {totalPages}
                  </span>
                  <button
                    onClick={() => goPage(page + 1)}
                    disabled={page >= totalPages || loading}
                    className="px-3 py-1.5 text-xs text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors disabled:opacity-40"
                  >
                    下一页
                  </button>
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
        title={confirmTitle}
        message={confirmMessage}
        confirmText={confirmButtonText}
        cancelText="取消"
        danger={confirmDanger}
      />
    </>
  );
}
