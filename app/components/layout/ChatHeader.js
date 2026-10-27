"use client";

import { Menu, SquarePen, FolderOpen } from "lucide-react";
import MonthlyUsage from "./MonthlyUsage";
import { useI18n } from "@/lib/client/i18n";

export default function ChatHeader({ title, onToggleSidebar, onStartNewChat, sidebarOpen, onOpenResources, projectName, userId, tasks, onOpenUsage }) {
  const { t, locale, setLocale } = useI18n();
  return (
    <header className="z-40 flex min-h-14 items-center gap-1 border-b border-zinc-200 bg-[var(--bg-primary)] px-2 py-2 sm:px-4">
      <button
        onClick={onToggleSidebar}
        type="button"
        aria-label={sidebarOpen ? t("收起对话列表", "Close chat list") : t("打开对话列表", "Open chat list")}
        aria-expanded={sidebarOpen}
        className="shrink-0 rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-primary md:hidden"
      >
        <Menu size={20} />
      </button>
      <h1 className="min-w-0 flex-1 truncate px-1 text-sm font-medium text-zinc-800 sm:px-0">
        {title || t("新任务", "New task")}
      </h1>
      <div className="flex shrink-0 items-center sm:gap-1">
        <button type="button" onClick={() => setLocale(locale === "zh" ? "en" : "zh")} lang={locale === "zh" ? "en" : "zh"} aria-label={t("切换为 English", "Switch to 中文")} className="rounded-lg px-2 py-2 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-primary">
          {locale === "zh" ? "English" : "中文"}
        </button>
        <button type="button" onClick={onOpenResources} className="flex items-center gap-1.5 rounded-lg p-2 text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-primary" aria-label={projectName ? t("{project}：资料与成果", "{project}: files and results", { project: projectName }) : t("资料与成果", "Files and results")}>
          <FolderOpen size={18} /><span className="hidden max-w-28 truncate sm:inline">{projectName || t("资料", "Files")}</span>
        </button>
        <button
          onClick={onStartNewChat}
          type="button"
          aria-label={t("新任务", "New task")}
          className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-primary md:hidden"
        >
          <SquarePen size={19} />
        </button>
        {userId && <MonthlyUsage key={userId} tasks={tasks} onOpenUsage={onOpenUsage} />}
      </div>
    </header>
  );
}
