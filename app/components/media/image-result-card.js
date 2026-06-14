'use client';

import { ImageIcon } from 'lucide-react';

export default function ImageResultCard({ imageUrl, title = '生成的图片' }) {
  if (!imageUrl) return null;

  return (
    <div className="glass-effect rounded-2xl border border-zinc-200/60 dark:border-zinc-800/60 p-5 space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
        <ImageIcon className="h-5 w-5" />
        {title}
      </div>
      <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900">
        <img src={imageUrl} alt={title} className="mx-auto max-h-[640px] w-full object-contain" />
      </div>
      <a href={imageUrl} download className="inline-flex text-sm font-medium text-primary hover:underline">
        下载图片
      </a>
    </div>
  );
}
