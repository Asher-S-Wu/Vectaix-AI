'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Download, ImageIcon, Maximize2 } from 'lucide-react';
import ImageLightbox from '@/app/components/modals/ImageLightbox';

export default function ImageResultCard({ imageUrl, title = '生成的图片' }) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  if (!imageUrl) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="glass-effect rounded-2xl border border-zinc-200/60 dark:border-zinc-800/60 p-5 space-y-4"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
          <ImageIcon className="h-5 w-5 text-primary" />
          {title}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-500 hover:text-primary hover:bg-primary/5 transition-colors"
            title="查看大图"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            放大
          </button>
          <a
            href={imageUrl}
            download
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-500 hover:text-primary hover:bg-primary/5 transition-colors"
            title="下载图片"
          >
            <Download className="h-3.5 w-3.5" />
            下载
          </a>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setLightboxOpen(true)}
        className="block w-full overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 cursor-zoom-in"
        title="点击查看大图"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt={title} className="mx-auto max-h-[640px] w-auto max-w-full object-contain" />
      </button>
      <ImageLightbox open={lightboxOpen} onClose={() => setLightboxOpen(false)} src={imageUrl} />
    </motion.div>
  );
}
