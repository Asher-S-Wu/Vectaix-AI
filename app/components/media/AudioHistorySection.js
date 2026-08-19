"use client";

import { useId } from "react";
import { AnimatePresence } from "framer-motion";
import { AudioLines, History, RefreshCw } from "lucide-react";
import AudioFormError from "@/app/components/media/AudioFormError";

function HistorySkeleton() {
  return (
    <div className="space-y-2" aria-label="正在读取语音记录" aria-busy="true">
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="flex items-center gap-3 rounded-xl border border-zinc-200/70 bg-white/80 px-3.5 py-3 dark:border-zinc-800/70 dark:bg-zinc-950/70">
          <div className="h-9 w-9 animate-pulse rounded-lg bg-zinc-200 motion-reduce:animate-none dark:bg-zinc-800" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3.5 w-24 animate-pulse rounded bg-zinc-200 motion-reduce:animate-none dark:bg-zinc-800" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-zinc-100 motion-reduce:animate-none dark:bg-zinc-900" />
          </div>
          <div className="h-4 w-4 animate-pulse rounded bg-zinc-200 motion-reduce:animate-none dark:bg-zinc-800" />
        </div>
      ))}
    </div>
  );
}

export default function AudioHistorySection({
  title = "语音记录",
  description = "最多保留最近 100 条，点击单条记录展开播放。",
  totalCount,
  items,
  loading,
  error,
  onRefresh,
  renderItem,
  emptyTitle = "还没有语音记录",
  emptyDescription = "在上方输入文字并生成语音，结果会安全保存在这里。",
  onlyLatestHint = "当前只有上方这条新记录。",
}) {
  const titleId = useId();
  const count = totalCount ?? items.length;

  return (
    <section
      className="glass-effect overflow-hidden rounded-2xl border border-zinc-200/60 dark:border-zinc-800/60"
      aria-labelledby={titleId}
    >
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200/60 px-5 py-4 dark:border-zinc-800/60 sm:px-6">
        <div>
          <h2 id={titleId} className="flex items-center gap-2 text-base font-semibold">
            <History className="h-4 w-4 text-primary" />
            {title}
            {!loading && count > 0 ? (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                {count}
              </span>
            ) : null}
          </h2>
          <p className="mt-1 text-sm text-zinc-500">{description}</p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-zinc-200 px-3 text-sm font-medium text-zinc-700 transition-[background-color,transform] hover:bg-zinc-100 active:scale-[0.98] disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} />
          刷新
        </button>
      </div>

      <div className="p-3 sm:p-4">
        {error ? <AudioFormError message={error} className="mb-3" /> : null}

        {loading ? (
          <HistorySkeleton />
        ) : count === 0 ? (
          <div className="flex min-h-[200px] flex-col items-center justify-center rounded-xl border border-dashed border-zinc-200/80 bg-white/60 px-6 text-center dark:border-zinc-800 dark:bg-zinc-950/50">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <AudioLines className="h-6 w-6" />
            </span>
            <p className="mt-4 text-sm font-medium text-zinc-700 dark:text-zinc-200">{emptyTitle}</p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-zinc-500">{emptyDescription}</p>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-200/80 bg-white/60 px-5 py-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/50">
            {onlyLatestHint}
          </div>
        ) : (
          <div className="fade-scrollbar max-h-[480px] space-y-2 overflow-y-auto overscroll-contain pr-1">
            <AnimatePresence initial={false}>
              {items.map(renderItem)}
            </AnimatePresence>
          </div>
        )}
      </div>
    </section>
  );
}
