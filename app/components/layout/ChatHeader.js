"use client";

import { Menu, MessageSquarePlus, FolderOpen } from "lucide-react";
import ModeSwitcher from "./ModeSwitcher";

export default function ChatHeader({ onToggleSidebar, onStartNewChat, sidebarOpen, onOpenResources, projectName }) {
  return (
    <header className="px-4 py-3 glass-effect border-b border-zinc-200/50 flex flex-wrap items-center justify-between gap-y-2 z-40">
      <div className="flex items-center gap-1.5 sm:gap-3">
        <button
          onClick={onToggleSidebar}
          type="button"
          aria-label={sidebarOpen ? "收起对话列表" : "打开对话列表"}
          className="p-2 -ml-1 rounded-lg text-zinc-500 hover:text-primary hover:bg-zinc-100 md:hidden active:scale-90 transition-all"
        >
          <Menu size={22} />
        </button>
        <ModeSwitcher />
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        <button type="button" onClick={onOpenResources} className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm text-zinc-500 hover:text-primary hover:bg-zinc-100" title="查看资料与成果">
          <FolderOpen size={18} /><span className="max-w-28 truncate">{projectName || "资料"}</span>
        </button>
        <button
          onClick={onStartNewChat}
          type="button"
          aria-label="新建对话"
          title="新建对话"
          className="md:hidden p-2 rounded-lg text-zinc-500 hover:text-primary hover:bg-zinc-100 active:scale-90 transition-all"
        >
          <MessageSquarePlus size={22} />
        </button>
      </div>
    </header>
  );
}
