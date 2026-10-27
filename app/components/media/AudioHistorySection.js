"use client";

import { useI18n } from "@/lib/client/i18n";

import { useId } from "react";
import { RefreshCw } from "lucide-react";
import AudioFormError from "@/app/components/media/AudioFormError";

function HistorySkeleton() {
  const { t } = useI18n();

  return (
    <div className="space-y-2" aria-label={t("正在读取语音记录", "Loading audio history")} aria-busy="true">
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="flex items-center gap-3 rounded-xl border border-zinc-200 px-3.5 py-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3.5 w-24 animate-pulse motion-reduce:animate-none rounded bg-zinc-200" />
            <div className="h-3 w-1/2 animate-pulse motion-reduce:animate-none rounded bg-zinc-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AudioHistorySection({
  title,
  description,
  items,
  loading,
  error,
  onRefresh,
  renderItem,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}) {
  const { t, formatNumber } = useI18n();
  title ??= t("语音记录", "Audio history");
  description ??= t("记录保存在你的账号下，可播放、下载或删除。", "Recordings stay in your account. Play, download, or delete them here.");

  const titleId = useId();
  const count = items.length;

  return (
    <section
      className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-700"
      aria-labelledby={titleId}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <h2 id={titleId} className="flex items-center gap-2 text-base font-semibold">
            {title}
            {!loading && count > 0 ? (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium tabular-nums text-zinc-500">
                {formatNumber(count)}
              </span>
            ) : null}
          </h2>
          <p className="mt-1 text-sm text-zinc-500">{description}</p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-zinc-200 px-3 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} /> {t("刷新", "Refresh")} </button>
      </div>

      <div className="p-3 sm:p-4">
        {error ? <AudioFormError message={error} className="mb-3" /> : null}

        {loading ? (
          <HistorySkeleton />
        ) : count === 0 ? (
          <div className="flex min-h-[160px] flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 px-6 text-center">
            <p className="text-sm font-medium text-zinc-700">{t("还没有语音记录", "No recordings yet")}</p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-zinc-500">{t("生成的语音会显示在这里，可播放或下载。", "Generated audio will appear here to play or download.")}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map(renderItem)}
          </div>
        )}
        {hasMore && <button type="button" disabled={loading || loadingMore} onClick={onLoadMore} className="admin-button mt-4">{loadingMore ? t("正在读取…", "Loading…") : t("加载更多", "Load more")}</button>}
      </div>
    </section>
  );
}
