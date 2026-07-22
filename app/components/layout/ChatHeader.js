"use client";

import { Menu, MessageSquarePlus } from "lucide-react";
import ModeSwitcher from "../chat/ModeSwitcher";

export default function ChatHeader({ onToggleSidebar, onStartNewChat, modelReady, sidebarOpen }) {
  return (
    <header className="px-4 py-3 glass-effect border-b border-zinc-200/50 dark:border-zinc-700/50 flex items-center justify-between z-40 sticky top-0">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          type="button"
          aria-label={sidebarOpen ? "收起对话列表" : "打开对话列表"}
          className="p-2 -ml-1 text-zinc-500 hover:text-primary md:hidden active:scale-90 transition-all"
        >
          <Menu size={22} />
        </button>
        <ModeSwitcher ready={modelReady} />
      </div>
      <button
        onClick={onStartNewChat}
        type="button"
        aria-label="新建对话"
        title="新建对话"
        className="md:hidden p-2 text-zinc-500 hover:text-primary active:scale-90 transition-all"
      >
        <MessageSquarePlus size={22} />
      </button>
    </header>
  );
}
