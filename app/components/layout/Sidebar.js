"use client";
import { scopeGuestUrl } from "@/lib/client/guestAccess";


import { useState, useRef, useEffect } from "react";
import NextImage from "next/image";
import { LogOut, Pencil, Pin, Plus, Trash2, X } from "lucide-react";
import ConfirmModal from "../modals/ConfirmModal";
import { ModelGlyph } from "../common/ModelVisuals";
import BrandMark from "../common/BrandMark";

export default function Sidebar({
  isOpen,
  conversations,
  conversationsReady = true,
  conversationsError = false,
  onRetryConversations,
  currentConversationId,
  user,
  avatar,
  nickname,
  profileReady,
  onStartNewChat,
  onLoadConversation,
  onDeleteConversation,
  onRenameConversation,
  onOpenProfile,
  onLogout,
  onClose,
  onTogglePinConversation,
}) {
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, id: null, title: "" });
  const [pinConfirm, setPinConfirm] = useState({ open: false, id: null, title: "", nextPinned: false });
  const [editingId, setEditingId] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [activeActionsId, setActiveActionsId] = useState(null);
  const editInputRef = useRef(null);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const handleDeleteClick = (conv, e) => {
    e.stopPropagation();
    setDeleteConfirm({ open: true, id: conv._id, title: conv.title });
  };

  const handleConfirmDelete = async () => {
    try {
      if (deleteConfirm.id) {
        await onDeleteConversation(deleteConfirm.id);
      }
    } finally {
      setDeleteConfirm({ open: false, id: null, title: "" });
    }
  };

  const handleEditClick = (conv, e) => {
    e.stopPropagation();
    setEditingId(conv._id);
    setEditingTitle(conv.title);
  };

  const handlePinClick = (conv, e) => {
    e.stopPropagation();
    const nextPinned = !conv.pinned;
    setPinConfirm({ open: true, id: conv._id, title: conv.title, nextPinned });
  };

  const handleConfirmPin = async () => {
    try {
      if (pinConfirm.id) {
        await onTogglePinConversation(pinConfirm.id, pinConfirm.nextPinned);
      }
    } finally {
      setPinConfirm({ open: false, id: null, title: "", nextPinned: false });
    }
  };

  const handleSaveEdit = () => {
    const trimmed = editingTitle.trim();
    if (trimmed && trimmed !== conversations.find(c => c._id === editingId)?.title) {
      onRenameConversation(editingId, trimmed);
    }
    setEditingId(null);
    setEditingTitle("");
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingTitle("");
  };

  const revealActions = (id) => {
    setActiveActionsId(id);
  };

  const hideActions = (id) => {
    setActiveActionsId((current) => (current === id ? null : current));
  };

  const handleConversationClick = (conv) => {
    // Touch devices: first tap reveals the action bar, second tap opens the chat
    const isTouch = typeof window !== "undefined" && window.matchMedia("(hover: none)").matches;
    if (isTouch && activeActionsId !== conv._id && editingId !== conv._id) {
      revealActions(conv._id);
      return;
    }
    onLoadConversation(conv._id);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSaveEdit();
    } else if (e.key === "Escape") {
      handleCancelEdit();
    }
  };

  return (
    <>
      <div
        className={`fixed md:relative z-50 md:z-40 flex w-72 max-w-[85vw] h-full glass-effect border-r border-zinc-200/50 flex-col transform-gpu transition-transform duration-300 ease-out will-change-transform ${isOpen ? "translate-x-0" : "-translate-x-full pointer-events-none md:pointer-events-auto md:translate-x-0"
          }`}
      >
        <div className="px-4 pt-4 pb-3 flex items-center gap-2.5">
          <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-primary/10 border border-primary/15 shrink-0">
            <BrandMark size={18} />
          </span>
          <span className="text-[15px] font-bold tracking-tight text-zinc-800 dark:text-zinc-100">
            Vectaix <span className="text-primary">AI</span>
          </span>
        </div>

        <div className="px-3 pb-3 border-b border-zinc-200/50 dark:border-zinc-800/50 flex items-center gap-2">
          <button
            onClick={onStartNewChat}
            type="button"
            className="flex-1 flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 active:scale-[0.97] group border border-zinc-200/70 dark:border-zinc-700/70 hover:border-primary/40"
          >
            <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-white transition-all duration-200">
              <Plus size={14} strokeWidth={2.5} className="group-hover:rotate-90 transition-transform duration-300" />
            </span>
            新建对话
          </button>
          <button onClick={onClose} type="button" aria-label="关闭对话列表" className="md:hidden p-2 text-zinc-400 hover:bg-zinc-100 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1 fade-scrollbar">
          {!conversationsReady ? (
            <div className="space-y-1" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 py-3 px-3">
                  <div className="w-[18px] h-[18px] rounded bg-zinc-200 animate-pulse shrink-0" />
                  <div className="h-4 rounded bg-zinc-100 animate-pulse" style={{ width: `${62 - i * 12}%` }} />
                </div>
              ))}
            </div>
          ) : conversationsError ? (
            <div className="flex flex-col items-center justify-center text-center px-6 py-10 gap-3">
              <p className="text-sm text-zinc-500">会话列表加载失败</p>
              <button
                type="button"
                onClick={onRetryConversations}
                className="px-4 py-2 text-xs font-medium text-primary border border-primary/30 rounded-xl hover:bg-primary/5 transition-colors"
              >
                点击重试
              </button>
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center px-6 py-10 gap-2">
              <span className="flex items-center justify-center w-10 h-10 rounded-2xl bg-primary/10 text-primary">
                <Plus size={18} />
              </span>
              <p className="text-sm font-medium text-zinc-500">暂无对话</p>
              <p className="text-xs text-zinc-400 leading-relaxed">点击上方「新建对话」<br />开始你的第一次提问</p>
            </div>
          ) : conversations.map((conv) => (
            <div
              key={conv._id}
              onMouseEnter={() => revealActions(conv._id)}
              onMouseLeave={() => hideActions(conv._id)}
              className={`group relative flex items-center rounded-xl transition-all duration-200 border ${currentConversationId === conv._id
                ? "bg-white shadow-sm border-zinc-200/60"
                : "border-transparent hover:bg-zinc-100"
                }`}
            >
              {editingId === conv._id ? (
                <div className="flex-1 flex items-center gap-1 p-2">
                  <input
                    ref={editInputRef}
                    type="text"
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={handleSaveEdit}
                    aria-label="重命名对话"
                    className="flex-1 px-2 py-1.5 text-sm border border-primary rounded-lg focus:outline-none bg-white"
                  />
                </div>
              ) : (
                <>
                  <button
                    onClick={() => handleConversationClick(conv)}
                    aria-current={currentConversationId === conv._id ? "page" : undefined}
                    className={`flex-1 flex items-center gap-3 text-left py-3 px-3 text-sm min-w-0 transition-colors ${currentConversationId === conv._id
                      ? "text-primary font-semibold"
                      : "text-zinc-600 dark:text-zinc-400"
                      }`}
                  >
                    <span className={`shrink-0 transition-transform duration-200 ${currentConversationId === conv._id ? "scale-110" : "group-hover:scale-105 opacity-70 group-hover:opacity-100"}`}>
                      <ModelGlyph model={conv.model} size={18} />
                    </span>
                    <span className="truncate pr-20">{conv.title}</span>
                  </button>

                  <div className={`absolute right-2 flex items-center gap-0.5 transition-all duration-200 ${activeActionsId === conv._id ? "opacity-100 translate-x-0" : "opacity-0 translate-x-2 pointer-events-none group-hover:opacity-100 group-hover:translate-x-0 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:translate-x-0 group-focus-within:pointer-events-auto"}`}>
                    <button
                      onClick={(e) => handlePinClick(conv, e)}
                      className={`p-2 rounded-lg hover:bg-zinc-200 transition-colors ${conv.pinned
                        ? "text-primary"
                        : "text-zinc-400"
                        }`}
                      title={conv.pinned ? "取消置顶" : "置顶"}
                      aria-label={conv.pinned ? "取消置顶" : "置顶"}
                    >
                      <Pin size={16} fill={conv.pinned ? "currentColor" : "none"} />
                    </button>
                    <button
                      onClick={(e) => handleEditClick(conv, e)}
                      className="p-2 rounded-lg hover:bg-zinc-200 text-zinc-400 hover:text-zinc-600 transition-colors"
                      title="重命名"
                      aria-label="重命名"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      onClick={(e) => handleDeleteClick(conv, e)}
                      className="p-2 rounded-lg hover:bg-zinc-200 text-zinc-400 hover:text-red-500 transition-colors"
                      title="删除"
                      aria-label="删除"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-zinc-200/50 bg-zinc-50/50 dark:bg-zinc-900/50">
          {profileReady ? (
            <div className="flex items-center gap-3">
              <button
                onClick={onOpenProfile}
                className="flex items-center gap-3 flex-1 hover:bg-white p-2 rounded-xl transition-all active:scale-[0.98]"
              >
                {avatar ? (
                  <NextImage
                    src={scopeGuestUrl(avatar)}
                    alt="用户头像"
                    width={40}
                    height={40}
                    unoptimized
                    className="w-10 h-10 rounded-xl object-cover ring-2 ring-zinc-200 dark:ring-zinc-700"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-xl bg-zinc-200" />
                )}
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 truncate">
                    {nickname || user?.name || user?.email?.split('@')[0]}
                  </span>
                  {nickname && user?.kind !== "guest" ? (
                    <span className="text-[10px] text-zinc-400 truncate">
                      {user?.email}
                    </span>
                  ) : null}
                </div>
              </button>
              {user?.kind !== "guest" && <button
                onClick={onLogout}
                className="p-2.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                title="退出登录"
                aria-label="退出登录"
              >
                <LogOut size={18} />
              </button>}
            </div>
          ) : (
            <div className="flex items-center gap-3 p-2">
              <div className="w-10 h-10 rounded-xl bg-zinc-200 animate-pulse shrink-0" />
              <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                <div className="h-4 w-20 rounded bg-zinc-200 animate-pulse" />
                <div className="h-3 w-32 rounded bg-zinc-100 animate-pulse" />
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmModal
        open={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, id: null, title: "" })}
        onConfirm={handleConfirmDelete}
        title="删除对话"
        message={`确定要删除「${deleteConfirm.title}」吗？此操作无法撤销。`}
        confirmText="删除"
        danger
      />
      <ConfirmModal
        open={pinConfirm.open}
        onClose={() => setPinConfirm({ open: false, id: null, title: "", nextPinned: false })}
        onConfirm={handleConfirmPin}
        title={pinConfirm.nextPinned ? "置顶对话" : "取消置顶"}
        message={pinConfirm.nextPinned
          ? `确定要置顶「${pinConfirm.title}」吗？`
          : `确定要取消置顶「${pinConfirm.title}」吗？`}
        confirmText={pinConfirm.nextPinned ? "置顶" : "取消置顶"}
      />
    </>
  );
}
