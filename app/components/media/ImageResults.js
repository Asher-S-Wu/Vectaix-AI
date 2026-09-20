'use client';

import { ImagePlus, Loader2 } from 'lucide-react';
import ImageResultCard from './image-result-card';

export default function ImageResults({ results = [], loading = false, count = results.length, title = '生成的图片' }) {
  const items = loading ? Array.from({ length: count }) : results;
  return <div className={`grid gap-4 ${items.length > 1 ? 'sm:grid-cols-2' : 'grid-cols-1'}`} aria-busy={loading} aria-live="polite">
    {items.map((item, index) => loading ? (
      <div key={index} className="glass-effect rounded-2xl border border-zinc-200/60 p-5 space-y-4 dark:border-zinc-800/60">
        <div className="flex items-center gap-2 text-sm font-semibold"><Loader2 className="h-4 w-4 animate-spin text-primary" />{title}{count > 1 ? `（${index + 1}/${count}）` : ''}</div>
        <div className="flex h-[320px] items-center justify-center rounded-xl bg-primary/5 text-primary/60"><ImagePlus className="h-10 w-10 animate-pulse" /></div>
      </div>
    ) : item.success ? (
      <ImageResultCard key={index} imageUrl={item.url} title={items.length > 1 ? `${title} ${index + 1}` : title} />
    ) : (
      <div key={index} role="alert" className="flex min-h-48 flex-col justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 p-5 dark:border-red-900 dark:bg-red-950/20">
        <p className="text-sm font-medium text-red-600 dark:text-red-400">第 {index + 1} 张未能完成</p>
        <p className="break-words text-sm text-zinc-600 dark:text-zinc-300">{item.message}</p>
      </div>
    ))}
  </div>;
}
