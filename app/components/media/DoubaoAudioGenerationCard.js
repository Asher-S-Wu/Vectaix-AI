"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Captions,
  ChevronDown,
  Download,
  FileAudio2,
  Loader2,
  Trash2,
  Waves,
} from "lucide-react";
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

function Meta({ generation }) {
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
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
          {loading ? (
            <p className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />正在读取字幕…</p>
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

function Actions({ generation, deleting, deleteDisabled, onDelete }) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <a href={`${generation.audioUrl}?download=1`} download={formatFileName(generation)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
        <Download className="h-4 w-4" />下载
      </a>
      <button type="button" onClick={() => onDelete(generation)} disabled={deleting || deleteDisabled} aria-label="删除 Doubao 音频记录" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:border-zinc-700">
        {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
      </button>
    </div>
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
  const [expanded, setExpanded] = useState(featured);
  const contentId = `doubao-audio-generation-${generation.id}`;

  return (
    <motion.article
      layout={reduceMotion ? false : "position"}
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
      className={`overflow-hidden border ${featured ? "rounded-2xl border-primary/30 bg-primary/[0.04] shadow-sm" : "rounded-xl border-zinc-200/70 bg-white/80 dark:border-zinc-800/70 dark:bg-zinc-950/70"}`}
    >
      <button
        type="button"
        onClick={() => !featured && setExpanded((current) => !current)}
        aria-expanded={expanded}
        aria-controls={contentId}
        className={`flex w-full items-center gap-3 text-left ${featured ? "cursor-default px-4 pt-4 sm:px-5 sm:pt-5" : "px-3.5 py-3 hover:bg-zinc-50/80 dark:hover:bg-zinc-900/60"}`}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {featured ? <Waves className="h-4 w-4" /> : <FileAudio2 className="h-4 w-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            {MODE_LABELS[generation.mode] || "Doubao 音频"}
          </span>
          <span className="mt-0.5 block truncate text-xs text-zinc-500">{generation.textPrompt}</span>
        </span>
        {featured ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">刚刚生成</span> : (
          <>
            <span className="hidden text-xs tabular-nums text-zinc-400 md:inline">{formatShortDate(generation.createdAt)}</span>
            <ChevronDown className={`h-4 w-4 text-zinc-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
          </>
        )}
      </button>

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div id={contentId} initial={featured || reduceMotion ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className={`${featured ? "px-4 pb-4 pt-3 sm:px-5 sm:pb-5" : "border-t border-zinc-200/60 px-3.5 py-3.5 dark:border-zinc-800/60"}`}>
              <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-300">{generation.textPrompt}</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <audio controls preload="metadata" src={generation.audioUrl} className="h-10 w-full min-w-0 sm:flex-1" aria-label="Doubao 生成音频">你的浏览器不支持音频播放。</audio>
                <Actions generation={generation} deleting={deleting} deleteDisabled={deleteDisabled} onDelete={onDelete} />
              </div>
              <div className="mt-3"><Meta generation={generation} /></div>
              {generation.referenceCount ? <p className="mt-2 text-xs text-zinc-500">使用了 {generation.referenceCount} 个参考资源</p> : null}
              <SubtitlePanel generation={generation} />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.article>
  );
}
