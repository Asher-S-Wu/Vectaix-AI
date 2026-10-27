'use client';

import { useI18n } from "@/lib/client/i18n";

import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Download, Maximize2, Trash2 } from 'lucide-react';
import ImageLightbox from '@/app/components/modals/ImageLightbox';

export default function ImageResultCard({ imageUrl, title, onDelete, deleteLabel, deleteDisabled = false }) {
  const { t } = useI18n();
  title ??= t("生成的图片", "Generated image");

  const reduceMotion = useReducedMotion();
  const [lightboxOpen, setLightboxOpen] = useState(false);
  if (!imageUrl) return null;

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduceMotion ? 0 : 0.25, ease: 'easeOut' }}
      className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 space-y-4 dark:border-zinc-700"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 truncate text-sm font-semibold text-zinc-700">
          {title}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-zinc-600 hover:text-primary hover:bg-primary/10 transition-colors"
          >
            <Maximize2 className="h-3.5 w-3.5" /> {t("放大", "Enlarge")} </button>
          <a
            href={imageUrl}
            download
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-zinc-600 hover:text-primary hover:bg-primary/10 transition-colors"
          >
            <Download className="h-3.5 w-3.5" /> {t("下载", "Download")} </a>
          {onDelete && <button type="button" aria-label={deleteLabel} disabled={deleteDisabled} onClick={onDelete} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-zinc-600 hover:bg-red-50 hover:text-red-600 transition-colors disabled:opacity-50">
            <Trash2 className="h-3.5 w-3.5" /> {t("删除", "Delete")}</button>}
        </div>
      </div>
      <button
        type="button"
        onClick={() => setLightboxOpen(true)}
        aria-label={t("查看大图：{title}", "View full size: {title}", { title })}
        className="block w-full overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 cursor-zoom-in"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt={title} loading="lazy" decoding="async" className="mx-auto min-h-[160px] max-h-[640px] w-auto max-w-full object-contain" />
      </button>
      <ImageLightbox open={lightboxOpen} onClose={() => setLightboxOpen(false)} src={imageUrl} />
    </motion.div>
  );
}
