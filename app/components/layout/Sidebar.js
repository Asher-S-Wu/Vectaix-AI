"use client";

import { useState, useRef, useEffect } from "react";
import NextImage from "next/image";
import { LogOut, Pencil, Pin, Plus, Trash2, X } from "lucide-react";
import ConfirmModal from "../modals/ConfirmModal";
import { ModelGlyph } from "../common/ModelVisuals";

export default function Sidebar({
  isOpen,
  conversations,
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
  onDuplicateConversation,
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

  const handleConversationTouchStart = (conv, e) => {
    if (activeActionsId === conv._id || editingId === conv._id) return;
    revealActions(conv._id);
  };

  const handleDuplicateClick = async (conv, e) => {
    e.stopPropagation();
    await onDuplicateConversation?.(conv._id);
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
        <div className="p-3 border-b border-zinc-200/50 dark:border-zinc-800/50 flex items-center gap-2">
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
          <button onClick={onClose} type="button" aria-label="关闭对话列表" className="md:hidden p-2 text-zinc-400 hover:bg-zinc-100 rounded-lg">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1 fade-scrollbar">
          {conversations.map((conv) => (
            <div
              key={conv._id}
              onMouseEnter={() => revealActions(conv._id)}
              onMouseLeave={() => hideActions(conv._id)}
              className={`group relative flex items-center rounded-xl transition-all duration-200 ${currentConversationId === conv._id
                ? "bg-white dark:bg-zinc-800 shadow-sm border border-zinc-200/60"
                : "hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
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
                    className="flex-1 px-2 py-1.5 text-sm border border-primary rounded-lg focus:outline-none bg-white dark:bg-zinc-900"
                  />
                </div>
              ) : (
                <>
                  <button
                    onClick={() => onLoadConversation(conv._id)}
                    onTouchStart={(e) => handleConversationTouchStart(conv, e)}
                    className={`flex-1 flex items-center gap-3 text-left py-3 px-3 text-sm min-w-0 transition-colors ${currentConversationId === conv._id
                      ? "text-primary font-semibold"
                      : "text-zinc-600 dark:text-zinc-400"
                      }`}
                  >
                    <span className={`shrink-0 transition-transform duration-200 ${currentConversationId === conv._id ? "scale-110" : "group-hover:scale-105 opacity-70 group-hover:opacity-100"}`}>
                      <ModelGlyph model={conv.model} size={18} />
                    </span>
                    <span className="truncate pr-8">{conv.title}</span>
                  </button>
                  
                  <div className={`absolute right-2 flex items-center gap-0.5 transition-all duration-200 ${activeActionsId === conv._id ? "opacity-100 translate-x-0" : "opacity-0 translate-x-2 pointer-events-none group-hover:opacity-100 group-hover:translate-x-0 group-hover:pointer-events-auto"}`}>
                    <button
                      onClick={(e) => handlePinClick(conv, e)}
                      className={`p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors ${conv.pinned
                        ? "text-blue-500"
                        : "text-zinc-400"
                        }`}
                      title={conv.pinned ? "取消置顶" : "置顶"}
                    >
                      <Pin size={14} fill={conv.pinned ? "currentColor" : "none"} />
                    </button>
                    <button
                      onClick={(e) => handleEditClick(conv, e)}
                      className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-zinc-600 transition-colors"
                      title="重命名"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={(e) => handleDeleteClick(conv, e)}
                      className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-red-500 transition-colors"
                      title="删除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-zinc-200/50 dark:border-zinc-800/50 bg-zinc-50/50 dark:bg-zinc-900/50">
          {profileReady ? (
            <div className="flex items-center gap-3">
              <button
                onClick={onOpenProfile}
                className="flex items-center gap-3 flex-1 hover:bg-white dark:hover:bg-zinc-800 p-2 rounded-xl transition-all active:scale-[0.98]"
              >
                {avatar ? (
                  <NextImage
                    src={avatar}
                    alt=""
                    width={40}
                    height={40}
                    unoptimized
                    className="w-10 h-10 rounded-xl object-cover ring-2 ring-zinc-200 dark:ring-zinc-700"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-xl bg-zinc-200 dark:bg-zinc-700" />
                )}
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 truncate">
                    {nickname || user?.email?.split('@')[0]}
                  </span>
                  <span className="text-[10px] text-zinc-400 truncate">
                    {user?.email}
                  </span>
                </div>
              </button>
              <button
                onClick={onLogout}
                className="p-2.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-all"
                title="退出登录"
              >
                <LogOut size={18} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 p-2">
              <div className="w-10 h-10 rounded-xl bg-zinc-200 dark:bg-zinc-700 animate-pulse shrink-0" />
              <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                <div className="h-4 w-20 rounded bg-zinc-200 dark:bg-zinc-700 animate-pulse" />
                <div className="h-3 w-32 rounded bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
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
