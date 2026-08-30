"use client";
import { scopeGuestUrl } from "@/lib/client/guestAccess";


import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown, FileAudio2, Waves } from "lucide-react";
import {
  AudioDeleteButton,
  AudioDownloadButton,
} from "@/app/components/media/AudioCardButtons";
import { AUDIO_LANGUAGE_HINTS } from "@/lib/media/shared/models";

const LANGUAGE_LABELS = Object.fromEntries(
  AUDIO_LANGUAGE_HINTS.map((item) => [item.id, item.label]),
);

function formatDate(value) {
  const date = new Date(value);
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatShortDate(value) {
  const date = new Date(value);
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatFileName(generation) {
  const timestamp = new Date(generation.createdAt)
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\.\d{3}Z$/, "");
  return `vectaix-语音-${timestamp}.${generation.format}`;
}

function GenerationMeta({ generation, language }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
      <span>{generation.format.toUpperCase()} · {(generation.sampleRate / 1000).toFixed(0)} kHz</span>
      <span>语速 {generation.rate.toFixed(1)}×</span>
      <span>音调 {generation.pitch.toFixed(1)}×</span>
      <span>音量 {generation.volume}</span>
      <span>{language}</span>
      <span>{generation.characters.toLocaleString("zh-CN")} 个计费字符</span>
      <span>{formatDate(generation.createdAt)}</span>
    </div>
  );
}

function CardActions({ generation, deleting, deleteDisabled, onDelete, className = "" }) {
  return (
    <>
      <AudioDownloadButton
        href={scopeGuestUrl(`${generation.audioUrl}?download=1`)}
        fileName={formatFileName(generation)}
        className={className}
      />
      <AudioDeleteButton
        deleting={deleting}
        disabled={deleteDisabled}
        onClick={() => onDelete(generation)}
        label={`删除 ${generation.voiceName} 的语音记录`}
        title="删除语音"
      />
    </>
  );
}

export default function AudioGenerationCard({
  generation,
  deleting = false,
  deleteDisabled = false,
  featured = false,
  audioRef,
  onDelete,
}) {
  const reduceMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const language = LANGUAGE_LABELS[generation.languageHint];

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
                  {generation.voiceName}
                </h4>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                  刚刚生成
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                {generation.text}
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
          ref={audioRef}
          className="mt-4 h-11 w-full"
          controls
          preload="metadata"
          src={scopeGuestUrl(generation.audioUrl)}
          aria-label={`${generation.voiceName} 生成的语音`}
        >
          你的浏览器不支持音频播放。
        </audio>

        <div className="mt-3">
          <GenerationMeta generation={generation} language={language} />
        </div>

        {generation.instruction ? (
          <p className="mt-3 rounded-lg bg-zinc-100/80 px-3 py-2 text-xs leading-5 text-zinc-600 dark:bg-zinc-800/70 dark:text-zinc-300">
            表达要求：{generation.instruction}
          </p>
        ) : null}
      </motion.article>
    );
  }

  const contentId = `audio-generation-${generation.id}`;

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
          <span className="font-semibold text-zinc-800 dark:text-zinc-100">{generation.voiceName}</span>
          <span className="mx-1.5 text-zinc-300 dark:text-zinc-600" aria-hidden="true">·</span>
          <span className="text-zinc-500 dark:text-zinc-400">{generation.text}</span>
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
              <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                {generation.text}
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <audio
                  className="h-10 w-full min-w-0 sm:flex-1"
                  controls
                  preload="metadata"
                  src={scopeGuestUrl(generation.audioUrl)}
                  aria-label={`${generation.voiceName} 生成的语音`}
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
                <GenerationMeta generation={generation} language={language} />
              </div>
              {generation.instruction ? (
                <p className="mt-3 rounded-lg bg-zinc-100/80 px-3 py-2 text-xs leading-5 text-zinc-600 dark:bg-zinc-800/70 dark:text-zinc-300">
                  表达要求：{generation.instruction}
                </p>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.article>
  );
}
