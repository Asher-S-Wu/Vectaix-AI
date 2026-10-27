'use client';

import { useI18n } from "@/lib/client/i18n";

import { ImagePlus, Loader2 } from 'lucide-react';
import ImageResultCard from './image-result-card';

export default function ImageResults({ results = [], loading = false, count = results.length, title }) {
  const { t, formatNumber, localizeMessage } = useI18n();
  title ??= t("生成的图片", "Generated image");

  const items = loading ? Array.from({ length: count }) : results;
  return <div className={`grid gap-4 ${items.length > 1 ? 'sm:grid-cols-2' : 'grid-cols-1'}`} aria-busy={loading} aria-live="polite">
    {items.map((item, index) => loading ? (
      <div key={index} className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-4 dark:border-zinc-700">
        <div className="flex items-center gap-2 text-sm font-semibold"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none text-primary" />{title}{count > 1 ? t("（{index}/{count}）", " ({index}/{count})", { index: formatNumber(index + 1), count: formatNumber(count) }) : ''}</div>
        <div className="flex h-[320px] items-center justify-center rounded-xl bg-primary/5 text-primary/60"><ImagePlus className="h-10 w-10 animate-pulse motion-reduce:animate-none" aria-hidden="true" /></div>
      </div>
    ) : item.success ? (
      <ImageResultCard key={index} imageUrl={item.url} title={items.length > 1 ? `${title} ${formatNumber(index + 1)}` : title} />
    ) : (
      <div key={index} role="alert" className="flex min-h-48 flex-col justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 p-5">
        <p className="text-sm font-medium text-red-600 dark:text-red-400">{t("第 {index} 张生成失败", "Image {index} failed to generate", { index: formatNumber(index + 1) })}</p>
        <p className="break-words text-sm text-zinc-600">{localizeMessage(item.message)}</p>
      </div>
    ))}
  </div>;
}
