"use client";

import { Menu, MessageSquarePlus, FolderOpen } from "lucide-react";
import ModeSwitcher from "./ModeSwitcher";
import MonthlyUsage from "./MonthlyUsage";

export default function ChatHeader({ onToggleSidebar, onStartNewChat, sidebarOpen, onOpenResources, projectName, userId, tasks, onOpenUsage }) {
  return (
    <header className="px-2 py-3 sm:px-4 glass-effect border-b border-zinc-200/50 flex flex-wrap items-center justify-between gap-x-1 gap-y-2 z-40">
      <div className="flex shrink-0 items-center gap-0.5 sm:gap-3">
        <button
          onClick={onToggleSidebar}
          type="button"
          aria-label={sidebarOpen ? "收起对话列表" : "打开对话列表"}
          className="p-1.5 sm:p-2 rounded-lg text-zinc-500 hover:text-primary hover:bg-zinc-100 md:hidden active:scale-90 transition-all"
        >
          <Menu size={20} />
        </button>
        <ModeSwitcher />
      </div>
      <div className="ml-auto flex shrink-0 items-center sm:gap-1.5">
        <button type="button" onClick={onOpenResources} className="flex items-center gap-1.5 rounded-lg p-1.5 sm:p-2 text-sm text-zinc-500 hover:text-primary hover:bg-zinc-100" aria-label="查看资料与成果" title={projectName ? `${projectName} · 查看资料与成果` : "查看资料与成果"}>
          <FolderOpen size={18} /><span className="hidden max-w-28 truncate sm:inline">{projectName || "资料"}</span>
        </button>
        <button
          onClick={onStartNewChat}
          type="button"
          aria-label="新建对话"
          title="新建对话"
          className="md:hidden p-1.5 sm:p-2 rounded-lg text-zinc-500 hover:text-primary hover:bg-zinc-100 active:scale-90 transition-all"
        >
          <MessageSquarePlus size={20} />
        </button>
        {userId && <MonthlyUsage key={userId} tasks={tasks} onOpenUsage={onOpenUsage} />}
      </div>
    </header>
  );
}
