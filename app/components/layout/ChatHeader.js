"use client";

import { Menu, MessageSquarePlus } from "lucide-react";
import ModeSwitcher from "../chat/ModeSwitcher";
import CreditShell from "../credits/CreditShell";

export default function ChatHeader({ onToggleSidebar, onStartNewChat, modelReady, sidebarOpen }) {
  return (
    <header className="px-4 py-3 glass-effect border-b border-zinc-200/50 flex flex-wrap items-center justify-between z-40">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          type="button"
          aria-label={sidebarOpen ? "收起对话列表" : "打开对话列表"}
          className="p-2 -ml-1 rounded-lg text-zinc-500 hover:text-primary hover:bg-zinc-100 md:hidden active:scale-90 transition-all"
        >
          <Menu size={22} />
        </button>
        <ModeSwitcher ready={modelReady} />
      </div>
      <div className="flex items-center gap-1.5">
        <CreditShell />
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
