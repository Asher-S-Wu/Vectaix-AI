'use client';

import { Clapperboard } from 'lucide-react';

export default function VideoResultCard({ videoUrl }) {
  if (!videoUrl) return null;

  return (
    <div className="glass-effect rounded-2xl border border-zinc-200/60 dark:border-zinc-800/60 p-5 space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
        <Clapperboard className="h-5 w-5" />
        生成的视频
      </div>
      <video
        controls
        playsInline
        className="w-full overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700 bg-black"
        src={videoUrl}
      >
        您的浏览器不支持视频播放。
      </video>
      <a href={videoUrl} download className="inline-flex text-sm font-medium text-primary hover:underline">
        下载视频
      </a>
    </div>
  );
}
