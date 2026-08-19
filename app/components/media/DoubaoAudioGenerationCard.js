"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Captions,
  ChevronDown,
  FileAudio2,
  Loader2,
  Waves,
} from "lucide-react";
import {
  AudioDeleteButton,
  AudioDownloadButton,
} from "@/app/components/media/AudioCardButtons";
import { getDoubaoAudioGeneration } from "@/lib/media/client/media";

const MODE_LABELS = Object.freeze({
  text: "纯文本",
  "audio-reference": "参考音频",
});

function formatDate(value) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function formatShortDate(value) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDuration(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return "—";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return minutes ? `${minutes}:${remainder.toFixed(1).padStart(4, "0")}` : `${remainder.toFixed(1)} 秒`;
}

function formatFileName(generation) {
  const timestamp = new Date(generation.createdAt)
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\.\d{3}Z$/, "");
  return `vectaix-doubao-audio-${timestamp}.${generation.format}`;
}

function GenerationMeta({ generation }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
      <span>{MODE_LABELS[generation.mode] || generation.mode}</span>
      <span>{generation.format.toUpperCase()}</span>
      <span>时长 {formatDuration(generation.duration)}</span>
      <span>语速 {generation.speechRate}</span>
      <span>{formatDate(generation.createdAt)}</span>
    </div>
  );
}

function SubtitlePanel({ generation }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [subtitle, setSubtitle] = useState(null);
  const [error, setError] = useState("");

  if (!generation.subtitleEnabled) return null;
  if (!generation.hasSubtitle) {
    return <p className="mt-3 text-xs text-zinc-500">此次结果没有字幕。</p>;
  }

  const toggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (subtitle || loading) return;
    setLoading(true);
    setError("");
    try {
      const detail = await getDoubaoAudioGeneration(generation.id);
      setSubtitle(detail.subtitle || null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取字幕失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-900/50">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex h-10 w-full items-center justify-between gap-3 px-3 text-xs font-medium text-zinc-700 dark:text-zinc-200"
      >
        <span className="flex items-center gap-2"><Captions className="h-4 w-4 text-primary" />字幕</span>
        <ChevronDown className={`h-4 w-4 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
          {loading ? (
            <p className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />正在读取字幕…</p>
          ) : error ? (
            <p className="text-xs text-red-600" role="alert">{error}</p>
          ) : subtitle ? (
            <>
              {subtitle.text ? (
                <p className="mb-3 rounded-lg bg-white px-3 py-2 text-xs leading-5 text-zinc-600 dark:bg-zinc-950 dark:text-zinc-300">
                  {subtitle.text}
                </p>
              ) : null}
              <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                {(subtitle.sentences || []).map((sentence, index) => (
                  <div key={`${sentence.startTime}-${index}`} className="rounded-lg bg-white px-3 py-2 dark:bg-zinc-950">
                    <p className="text-[11px] tabular-nums text-zinc-400">
                      {(sentence.startTime / 1000).toFixed(2)}s – {(sentence.endTime / 1000).toFixed(2)}s
                    </p>
                    <p className="mt-1 text-xs leading-5 text-zinc-700 dark:text-zinc-200">{sentence.text}</p>
                  </div>
                ))}
              </div>
            </>
          ) : <p className="text-xs text-zinc-500">此次结果没有字幕。</p>}
        </div>
      ) : null}
    </div>
  );
}

function CardActions({ generation, deleting, deleteDisabled, onDelete, className = "" }) {
  return (
    <>
      <AudioDownloadButton
        href={`${generation.audioUrl}?download=1`}
        fileName={formatFileName(generation)}
        className={className}
      />
      <AudioDeleteButton
        deleting={deleting}
        disabled={deleteDisabled}
        onClick={() => onDelete(generation)}
        label="删除这条音频记录"
        title="删除音频"
      />
    </>
  );
}

export default function DoubaoAudioGenerationCard({
  generation,
  featured = false,
  deleting = false,
  deleteDisabled = false,
  onDelete,
}) {
  const reduceMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const modeLabel = MODE_LABELS[generation.mode] || "Doubao 音频";

  if (featured) {
    return (
      <motion.article
        layout={reduceMotion ? false : "position"}
        initial={reduceMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="rounded-2xl border border-primary/30 bg-primary/[0.04] p-4 shadow-sm sm:p-5"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Waves className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                  {modeLabel}
                </h4>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                  刚刚生成
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                {generation.textPrompt}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:pl-3">
            <CardActions
              generation={generation}
              deleting={deleting}
              deleteDisabled={deleteDisabled}
              onDelete={onDelete}
            />
          </div>
        </div>

        <audio
          className="mt-4 h-11 w-full"
          controls
          preload="metadata"
          src={generation.audioUrl}
          aria-label="Doubao 生成音频"
        >
          你的浏览器不支持音频播放。
        </audio>

        <div className="mt-3">
          <GenerationMeta generation={generation} />
        </div>
        {generation.referenceCount ? (
          <p className="mt-2 text-xs text-zinc-500">使用了 {generation.referenceCount} 个参考资源</p>
        ) : null}
        <SubtitlePanel generation={generation} />
      </motion.article>
    );
  }

  const contentId = `doubao-audio-generation-${generation.id}`;

  return (
    <motion.article
      layout={reduceMotion ? false : "position"}
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className={`overflow-hidden rounded-xl border transition-colors ${
        expanded
          ? "border-zinc-300/80 bg-white dark:border-zinc-700 dark:bg-zinc-950"
          : "border-zinc-200/70 bg-white/80 dark:border-zinc-800/70 dark:bg-zinc-950/70"
      }`}
    >
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        aria-controls={contentId}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-zinc-50/80 dark:hover:bg-zinc-900/60"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <FileAudio2 className="h-4 w-4" />
        </span>
        <span className="block min-w-0 flex-1 truncate text-sm">
          <span className="font-semibold text-zinc-800 dark:text-zinc-100">{modeLabel}</span>
          <span className="mx-1.5 text-zinc-300 dark:text-zinc-600" aria-hidden="true">·</span>
          <span className="text-zinc-500 dark:text-zinc-400">{generation.textPrompt}</span>
        </span>
        <span className="hidden shrink-0 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 sm:inline">
          {generation.format.toUpperCase()}
        </span>
        <span className="hidden shrink-0 text-xs tabular-nums text-zinc-400 md:inline">
          {formatShortDate(generation.createdAt)}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            id={contentId}
            initial={reduceMotion ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-zinc-200/60 px-3.5 py-3.5 dark:border-zinc-800/60">
              <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-300">{generation.textPrompt}</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <audio
                  controls
                  preload="metadata"
                  src={generation.audioUrl}
                  className="h-10 w-full min-w-0 sm:flex-1"
                  aria-label="Doubao 生成音频"
                >
                  你的浏览器不支持音频播放。
                </audio>
                <div className="flex shrink-0 items-center gap-2">
                  <CardActions
                    generation={generation}
                    deleting={deleting}
                    deleteDisabled={deleteDisabled}
                    onDelete={onDelete}
                    className="flex-1 sm:flex-none"
                  />
                </div>
              </div>
              <div className="mt-3">
                <GenerationMeta generation={generation} />
              </div>
              {generation.referenceCount ? (
                <p className="mt-2 text-xs text-zinc-500">使用了 {generation.referenceCount} 个参考资源</p>
              ) : null}
              <SubtitlePanel generation={generation} />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.article>
  );
}
