"use client";

import { motion } from "framer-motion";
import { Download, Loader2, Trash2 } from "lucide-react";
import {
  MINIMAX_AUDIO_EMOTION_OPTIONS,
  MINIMAX_AUDIO_LANGUAGE_OPTIONS,
  MINIMAX_AUDIO_MODELS,
} from "@/lib/media/shared/minimaxAudio";

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function downloadName(generation) {
  const stamp = new Date(generation.createdAt)
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\.\d{3}Z$/, "");
  return `vectaix-minimax-${stamp}.${generation.format}`;
}

function lookup(options, id, fallback = "") {
  return options.find((item) => item.id === id)?.label || fallback;
}

export default function MinimaxAudioGenerationCard({
  generation,
  featured = false,
  deleting = false,
  deleteDisabled = false,
  onDelete,
}) {
  const model = lookup(MINIMAX_AUDIO_MODELS, generation.model, generation.model);
  const emotion = lookup(MINIMAX_AUDIO_EMOTION_OPTIONS, generation.emotion, "自动情感");
  const language = lookup(MINIMAX_AUDIO_LANGUAGE_OPTIONS, generation.languageBoost, "自动语言");
  const duration = generation.durationMs > 0
    ? `${(generation.durationMs / 1000).toFixed(1)} 秒`
    : "时长由播放器显示";

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className={`overflow-hidden rounded-2xl border ${
        featured
          ? "border-primary/30 bg-primary/[0.035] shadow-sm"
          : "border-zinc-200 bg-white/80 dark:border-zinc-800 dark:bg-zinc-950/70"
      }`}
    >
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                {generation.voiceName}
              </h3>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                {generation.voiceKind === "custom" ? "复刻音色" : "系统音色"}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-sm leading-6 text-zinc-500">{generation.text}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <a
              href={`${generation.audioUrl}?download=1`}
              download={downloadName(generation)}
              aria-label="下载这段语音"
              className="focus-ring rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-primary dark:hover:bg-zinc-800"
            >
              <Download className="h-4 w-4" />
            </a>
            <button
              type="button"
              onClick={() => onDelete(generation)}
              disabled={deleting || deleteDisabled}
              aria-label="删除这条语音记录"
              className="focus-ring rounded-lg p-2 text-zinc-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-red-950/30"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <audio controls preload="metadata" src={generation.audioUrl} className="h-10 w-full" aria-label={`${generation.voiceName} 生成的语音`} />

        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-400">
          <span>{model}</span>
          <span>{generation.format.toUpperCase()} · {(generation.sampleRate / 1000).toFixed(generation.sampleRate % 1000 ? 2 : 0)} kHz</span>
          <span>{emotion}</span>
          <span>{language}</span>
          <span>语速 {generation.speed.toFixed(1)}×</span>
          <span>音量 {generation.volume.toFixed(1)}</span>
          <span>音高 {generation.pitch > 0 ? "+" : ""}{generation.pitch}</span>
          <span>{duration}</span>
          <span>{generation.characters.toLocaleString("zh-CN")} 个计费字符</span>
          <span>{formatDate(generation.createdAt)}</span>
        </div>
      </div>
    </motion.article>
  );
}

