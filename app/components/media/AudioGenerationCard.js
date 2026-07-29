"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Download, FileAudio2, Loader2, Trash2, Waves } from "lucide-react";
import { AUDIO_LANGUAGE_HINTS } from "@/lib/media/shared/models";

const LANGUAGE_LABELS = Object.fromEntries(
  AUDIO_LANGUAGE_HINTS.map((item) => [item.id, item.label]),
);

function formatDate(value) {
  const date = new Date(value);
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatFileName(generation) {
  const timestamp = new Date(generation.createdAt)
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\.\d{3}Z$/, "");
  return `vectaix-语音-${timestamp}.${generation.format}`;
}

export default function AudioGenerationCard({
  generation,
  deleting = false,
  deleteDisabled = false,
  featured = false,
  onDelete,
}) {
  const reduceMotion = useReducedMotion();
  const language = LANGUAGE_LABELS[generation.languageHint];

  return (
    <motion.article
      layout={reduceMotion ? false : "position"}
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className={`rounded-2xl border p-4 sm:p-5 ${
        featured
          ? "border-primary/30 bg-primary/[0.04] shadow-sm"
          : "border-zinc-200/70 bg-white/80 shadow-sm dark:border-zinc-800/70 dark:bg-zinc-950/70"
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {featured ? <Waves className="h-5 w-5" /> : <FileAudio2 className="h-5 w-5" />}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                {generation.voiceName}
              </h4>
              {featured ? (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                  刚刚生成
                </span>
              ) : null}
            </div>
            <p className="mt-1 line-clamp-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
              {generation.text}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:pl-3">
          <a
            href={`${generation.audioUrl}?download=1`}
            download={formatFileName(generation)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-sm font-medium text-zinc-700 transition-[background-color,transform] hover:bg-zinc-100 active:scale-[0.98] dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <Download className="h-4 w-4" />
            下载
          </a>
          <button
            type="button"
            onClick={() => onDelete(generation)}
            disabled={deleting || deleteDisabled}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 transition-[background-color,color,transform] hover:border-red-200 hover:bg-red-50 hover:text-red-600 active:scale-[0.98] disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400"
            aria-label={`删除 ${generation.voiceName} 的语音记录`}
            title="删除语音"
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Trash2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <audio
        className="mt-4 h-11 w-full"
        controls
        preload="metadata"
        src={generation.audioUrl}
        aria-label={`${generation.voiceName} 生成的语音`}
      >
        你的浏览器不支持音频播放。
      </audio>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
        <span>{generation.format.toUpperCase()} · {(generation.sampleRate / 1000).toFixed(0)} kHz</span>
        <span>语速 {generation.rate.toFixed(1)}×</span>
        <span>音调 {generation.pitch.toFixed(1)}×</span>
        <span>音量 {generation.volume}</span>
        <span>{language}</span>
        <span>{generation.characters.toLocaleString("zh-CN")} 个计费字符</span>
        <span>{formatDate(generation.createdAt)}</span>
      </div>

      {generation.instruction ? (
        <p className="mt-3 rounded-lg bg-zinc-100/80 px-3 py-2 text-xs leading-5 text-zinc-600 dark:bg-zinc-800/70 dark:text-zinc-300">
          表达要求：{generation.instruction}
        </p>
      ) : null}
    </motion.article>
  );
}
