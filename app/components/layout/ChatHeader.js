"use client";

import { Menu, MessageSquarePlus, FolderOpen } from "lucide-react";
import ModeSwitcher from "./ModeSwitcher";
import MonthlyUsage from "./MonthlyUsage";
import { useI18n } from "@/lib/client/i18n";

export default function ChatHeader({ onToggleSidebar, onStartNewChat, sidebarOpen, onOpenResources, projectName, userId, tasks, onOpenUsage }) {
  const { t, locale, setLocale } = useI18n();
  return (
    <header className="px-2 py-3 sm:px-4 glass-effect border-b border-zinc-200/50 flex flex-wrap items-center justify-between gap-x-1 gap-y-2 z-40">
      <div className="flex shrink-0 items-center gap-0.5 sm:gap-3">
        <button
          onClick={onToggleSidebar}
          type="button"
          aria-label={sidebarOpen ? t("收起对话列表", "Close chat list") : t("打开对话列表", "Open chat list")}
          className="p-1.5 sm:p-2 rounded-lg text-zinc-500 hover:text-primary hover:bg-zinc-100 md:hidden active:scale-90 transition-all"
        >
          <Menu size={20} />
        </button>
        <ModeSwitcher />
      </div>
      <div className="ml-auto flex shrink-0 items-center sm:gap-1.5">
        <button type="button" onClick={() => setLocale(locale === "zh" ? "en" : "zh")} aria-label={t("切换为 English", "Switch to 中文")} title={t("切换语言", "Change language")} className="rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-primary dark:hover:bg-zinc-800">
          {locale === "zh" ? "English" : "中文"}
        </button>
        <button type="button" onClick={onOpenResources} className="flex items-center gap-1.5 rounded-lg p-1.5 sm:p-2 text-sm text-zinc-500 hover:text-primary hover:bg-zinc-100" aria-label={t("查看资料与成果", "View files and results")} title={projectName ? t("{project} · 查看资料与成果", "{project} · View files and results", { project: projectName }) : t("查看资料与成果", "View files and results")}>
          <FolderOpen size={18} /><span className="hidden max-w-28 truncate sm:inline">{projectName || t("资料", "Files")}</span>
        </button>
        <button
          onClick={onStartNewChat}
          type="button"
          aria-label={t("新建对话", "New chat")}
          title={t("新建对话", "New chat")}
          className="md:hidden p-1.5 sm:p-2 rounded-lg text-zinc-500 hover:text-primary hover:bg-zinc-100 active:scale-90 transition-all"
        >
          <MessageSquarePlus size={20} />
        </button>
        {userId && <MonthlyUsage key={userId} tasks={tasks} onOpenUsage={onOpenUsage} />}
      </div>
    </header>
  );
}
