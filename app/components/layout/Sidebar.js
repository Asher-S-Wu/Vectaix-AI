"use client";

import { useI18n } from "@/lib/client/i18n";

import Select from '@/app/components/common/Select';
import { useCallback, useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import NextImage from "next/image";
import { Folder, FolderInput, Images, LogOut, MoreHorizontal, Pencil, Pin, PinOff, Plus, Settings2, Trash2, X } from "lucide-react";
import ConfirmModal from "../modals/ConfirmModal";
import BrandMark from "../common/BrandMark";
import Link from "./NavigationMotion";

const MENU_WIDTH = 176;
const MENU_HEIGHT = 184;

function menuPosition(anchor) {
  const rect = anchor.getBoundingClientRect();
  const below = window.innerHeight - rect.bottom >= MENU_HEIGHT + 8;
  return { left: Math.max(8, rect.right - MENU_WIDTH), ...(below ? { top: rect.bottom + 4 } : { bottom: window.innerHeight - rect.top + 4 }) };
}

function ConversationMenu({ anchor, position, pinned, onClose, onPin, onRename, onMove, onDelete }) {
  const { t } = useI18n();
  const menuRef = useRef(null);

  useEffect(() => {
    menuRef.current?.querySelector("button")?.focus({ preventScroll: true });
    const close = () => onClose(false);
    const handlePointerDown = event => {
      if (!menuRef.current?.contains(event.target) && !anchor.contains(event.target)) close();
    };
    const handleKeyDown = event => {
      if (event.key === "Escape") { event.preventDefault(); onClose(true); return; }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const items = [...menuRef.current.querySelectorAll("button")];
      const index = items.indexOf(document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
      items[next]?.focus();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [anchor, onClose]);

  const item = "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:bg-zinc-100 focus-visible:outline-none dark:text-zinc-200";
  return createPortal(
    <div ref={menuRef} role="menu" aria-label={t("对话操作", "Chat actions")} style={{ position: "fixed", width: MENU_WIDTH, ...position }} className="z-[60] rounded-xl border border-zinc-200 bg-white p-1 shadow-pop dark:border-zinc-700">
      <button type="button" role="menuitem" className={item} onClick={onPin}>{pinned ? <PinOff size={15} /> : <Pin size={15} />}{pinned ? t("取消置顶", "Unpin") : t("置顶", "Pin")}</button>
      <button type="button" role="menuitem" className={item} onClick={onRename}><Pencil size={15} />{t("重命名", "Rename")}</button>
      <button type="button" role="menuitem" className={item} onClick={onMove}><FolderInput size={15} />{t("移动到项目", "Move to project")}</button>
      <button type="button" role="menuitem" className={`${item} text-red-600 hover:bg-red-50 focus-visible:bg-red-50 dark:text-red-300`} onClick={onDelete}><Trash2 size={15} />{t("删除", "Delete")}</button>
    </div>,
    document.body,
  );
}

export default function Sidebar({
  projects = [],
  activeProjectId = "all",
  onSelectProject,
  onManageProjects,
  onMoveConversation,
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
  const { t } = useI18n();
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, id: null, title: "" });
  const [editingId, setEditingId] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [menu, setMenu] = useState(null);
  const [movingId, setMovingId] = useState(null);
  const editInputRef = useRef(null);
  const editCancelledRef = useRef(false);
  const displayName = nickname || user?.name || user?.email?.split('@')[0] || "";

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const menuRef = useRef(null);
  useEffect(() => { menuRef.current = menu; }, [menu]);
  const closeMenu = useCallback((restoreFocus) => {
    const anchor = menuRef.current?.anchor;
    setMenu(null);
    if (restoreFocus && anchor?.isConnected) anchor.focus();
  }, []);

  const handleConfirmDelete = async () => {
    try {
      if (deleteConfirm.id) await onDeleteConversation(deleteConfirm.id);
    } finally {
      setDeleteConfirm({ open: false, id: null, title: "" });
    }
  };

  const startEdit = (conv) => {
    editCancelledRef.current = false;
    setEditingId(conv._id);
    setEditingTitle(conv.title);
  };

  const finishEdit = () => {
    const trimmed = editingTitle.trim();
    if (!editCancelledRef.current && trimmed && trimmed !== conversations.find(c => c._id === editingId)?.title) {
      onRenameConversation(editingId, trimmed);
    }
    editCancelledRef.current = false;
    setEditingId(null);
    setEditingTitle("");
  };

  const handleKeyDown = (e) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter") {
      e.preventDefault();
      finishEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      editCancelledRef.current = true;
      e.currentTarget.blur();
    }
  };

  const menuConversation = menu ? conversations.find(conv => conv._id === menu.id) : null;

  return (
    <>
      <div
        className={`agent-sidebar workspace-sidebar fixed md:relative z-50 md:z-40 flex w-72 max-w-[85vw] h-full border-r border-zinc-200 flex-col transform-gpu transition-[transform,visibility] duration-300 ease-out will-change-transform ${isOpen ? "translate-x-0" : "-translate-x-full max-md:invisible md:translate-x-0"}`}
      >
        <div className="px-4 pt-4 pb-3 flex items-center gap-2.5">
          <BrandMark size={36} />
          <span className="text-[15px] font-semibold text-zinc-800">
            {t("花卷", "Huajuan")}
          </span>
          <button onClick={onClose} type="button" aria-label={t("关闭对话列表", "Close chat list")} className="ml-auto md:hidden p-2 text-zinc-500 hover:bg-zinc-100 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="px-3 pb-3 flex flex-col gap-1">
          <button
            onClick={onStartNewChat}
            type="button"
            className="group flex min-h-11 items-center gap-2.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:border-primary/40 active:scale-[0.98] dark:border-zinc-700"
          >
            <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-white dark:group-hover:text-zinc-950">
              <Plus size={14} strokeWidth={2.5} />
            </span>
            {t("新任务", "New task")}
          </button>
          <Link href="/media" onNavigate={onClose} className="flex min-h-11 items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-zinc-600 transition-colors hover:bg-primary/10 hover:text-primary"><Images size={17} />{t("媒体创作", "Media studio")}</Link>
          {user?.isAdmin && <Link href="/settings?section=admin" onNavigate={onClose} className="flex min-h-11 items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-zinc-600 transition-colors hover:bg-primary/10 hover:text-primary"><Settings2 size={17} />{t("管理后台", "Admin")}</Link>}
        </div>

        <div className="px-3 py-3 border-t border-zinc-200">
          <div className="flex items-center justify-between mb-2 px-1"><span className="text-xs font-medium text-zinc-500 flex items-center gap-1.5"><Folder size={13} />{t("项目", "Projects")}</span><button type="button" onClick={onManageProjects} className="rounded-md px-1.5 py-1 text-xs text-primary hover:bg-primary/10">{t("管理项目", "Manage projects")}</button></div>
          <Select ariaLabel={t("筛选项目对话", "Filter chats by project")} value={activeProjectId === null ? "" : activeProjectId} onChange={value => onSelectProject(value === "" ? null : value)} options={[
            { id: "all", label: t("全部对话", "All chats") },
            { id: "", label: t("未归类", "Uncategorized") },
            ...projects.map(project => ({ id: project._id, label: project.name })),
          ]} />
        </div>
        <nav aria-label={t("对话列表", "Chats")} className="flex-1 overflow-y-auto px-3 pb-3 space-y-0.5 fade-scrollbar">
          {!conversationsReady ? (
            <div className="space-y-1 pt-1" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center py-3 px-3">
                  <div className="h-4 rounded bg-zinc-200 animate-pulse" style={{ width: `${72 - i * 14}%` }} />
                </div>
              ))}
            </div>
          ) : conversationsError ? (
            <div className="flex flex-col items-center justify-center text-center px-6 py-10 gap-3">
              <p className="text-sm text-zinc-500">{t("对话列表加载失败", "Could not load chats")}</p>
              <button
                type="button"
                onClick={onRetryConversations}
                className="px-4 py-2 text-xs font-medium text-primary border border-primary/30 rounded-xl hover:bg-primary/5 transition-colors"
              >
                {t("重新加载", "Reload")}
              </button>
            </div>
          ) : conversations.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-medium text-zinc-600">{t("还没有对话", "No chats yet")}</p>
              <p className="mt-1.5 text-xs text-zinc-500 leading-relaxed">{t("在右侧输入需求，对话会保存在这里。", "Describe a task to start. Your chats are saved here.")}</p>
            </div>
          ) : conversations.map((conv) => {
            const active = currentConversationId === conv._id;
            const menuOpen = menu?.id === conv._id;
            return (
            <div
              key={conv._id}
              className={`group relative rounded-xl transition-colors ${active ? "bg-white shadow-soft dark:bg-zinc-800" : "hover:bg-zinc-100"}`}
            >
              {editingId === conv._id ? (
                <div className="p-1.5">
                  <input
                    ref={editInputRef}
                    type="text"
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={finishEdit}
                    aria-label={t("重命名对话", "Rename chat")}
                    className="w-full px-2 py-1.5 text-sm border border-primary rounded-lg focus:outline-none bg-white dark:bg-zinc-900"
                  />
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onLoadConversation(conv._id)}
                    aria-current={active ? "page" : undefined}
                    className={`flex w-full min-h-11 items-center gap-2 py-2.5 pl-3 pr-11 text-left text-sm transition-colors ${active ? "text-primary font-medium" : "text-zinc-600"}`}
                  >
                    {conv.pinned && <Pin size={13} className="shrink-0 text-primary" fill="currentColor" aria-hidden="true" />}
                    <span className="truncate">{conv.title}</span>
                  </button>
                  <button
                    type="button"
                    onClick={(event) => { const anchor = event.currentTarget; setMenu(current => current?.id === conv._id ? null : { id: conv._id, anchor, position: menuPosition(anchor) }); }}
                    aria-label={t("“{title}”的操作", "Actions for “{title}”", { title: conv.title })}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    className={`absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-zinc-500 transition-opacity hover:bg-zinc-200 hover:text-zinc-800 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 ${menuOpen || active ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                  >
                    <MoreHorizontal size={16} />
                  </button>
                  {movingId === conv._id && <div className="px-3 pb-3"><Select ariaLabel={t("对话所属项目", "Chat project")} size="sm" value={conv.projectId || ""} onChange={async value => {
                    await onMoveConversation(conv._id, value || null);
                    setMovingId(null);
                  }} options={[
                    { id: "", label: t("未归类", "Uncategorized") },
                    ...projects.map(project => ({ id: project._id, label: project.name })),
                  ]} /></div>}
                </>
              )}
            </div>
            );
          })}
        </nav>

        <div className="p-3 border-t border-zinc-200">
          {profileReady ? (
            <div className="flex items-center gap-1">
              <button
                onClick={onOpenProfile}
                type="button"
                aria-label={t("设置", "Settings")}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-zinc-100"
              >
                {avatar ? (
                  <NextImage
                    src={avatar}
                    alt=""
                    width={36}
                    height={36}
                    unoptimized
                    className="h-9 w-9 shrink-0 rounded-xl object-cover"
                  />
                ) : (
                  <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-sm font-semibold text-primary">
                    {displayName.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-zinc-800">{displayName}</span>
                  <span className="truncate text-xs text-zinc-500">{t("设置", "Settings")}</span>
                </span>
              </button>
              <button
                type="button"
                onClick={onLogout}
                className="rounded-xl p-2.5 text-zinc-500 transition-colors hover:bg-red-50 hover:text-red-500"
                title={t("退出登录", "Sign out")}
                aria-label={t("退出登录", "Sign out")}
              >
                <LogOut size={18} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 p-2" aria-hidden="true">
              <div className="h-9 w-9 rounded-xl bg-zinc-200 animate-pulse shrink-0" />
              <div className="h-4 w-24 rounded bg-zinc-200 animate-pulse" />
            </div>
          )}
        </div>
      </div>

      {menu && menuConversation && <ConversationMenu
        anchor={menu.anchor}
        position={menu.position}
        pinned={Boolean(menuConversation.pinned)}
        onClose={closeMenu}
        onPin={() => { closeMenu(true); onTogglePinConversation(menuConversation._id, !menuConversation.pinned); }}
        onRename={() => { closeMenu(false); startEdit(menuConversation); }}
        onMove={() => { closeMenu(false); setMovingId(id => id === menuConversation._id ? null : menuConversation._id); }}
        onDelete={() => { closeMenu(false); setDeleteConfirm({ open: true, id: menuConversation._id, title: menuConversation.title }); }}
      />}

      <ConfirmModal
        open={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, id: null, title: "" })}
        onConfirm={handleConfirmDelete}
        title={t("删除对话", "Delete chat")}
        message={t("删除“{title}”？此操作无法撤销。", "Delete “{title}”? This action is permanent.", { title: deleteConfirm.title })}
        confirmText={t("删除", "Delete")}
        danger
      />
    </>
  );
}
