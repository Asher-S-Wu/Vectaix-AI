"use client";


import { motion } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Download,
  HardDrive,
  Link2,
  Loader2,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";

const DELETABLE_STATUSES = new Set(["completed", "failed", "canceled"]);

const STATUS_META = Object.freeze({
  submitting: Object.freeze({ label: "正在提交", tone: "amber", icon: Clock3 }),
  running: Object.freeze({ label: "增强处理中", tone: "sky", icon: WandSparkles }),
  finalizing: Object.freeze({ label: "正在保存", tone: "violet", icon: Loader2 }),
  completed: Object.freeze({ label: "已完成", tone: "emerald", icon: CheckCircle2 }),
  failed: Object.freeze({ label: "处理失败", tone: "red", icon: AlertCircle }),
  canceled: Object.freeze({ label: "已取消", tone: "zinc", icon: X }),
});

const STATUS_CLASSES = Object.freeze({
  amber: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-300",
  sky: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/70 dark:bg-sky-950/30 dark:text-sky-300",
  violet: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/70 dark:bg-violet-950/30 dark:text-violet-300",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-300",
  red: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300",
  zinc: "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
});

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes >= 1024 ** 3) return `${(bytes / (1024 ** 3)).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / (1024 ** 2)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatDuration(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
    : `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function formatDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatResolution(value) {
  return value === "2k" ? "2K" : value || "";
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.submitting;
  const Icon = meta.icon;
  const spinning = ["running", "finalizing"].includes(status);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${STATUS_CLASSES[meta.tone]}`}>
      <Icon className={`h-3.5 w-3.5 ${spinning ? "animate-spin" : ""}`} aria-hidden />
      {meta.label}
    </span>
  );
}

function SettingPill({ children }) {
  return (
    <span className="rounded-lg border border-zinc-200/80 bg-zinc-50 px-2.5 py-1 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
      {children}
    </span>
  );
}

export default function VideoEnhancementTaskCard({ task, deleting, onDelete }) {
  const source = task.source || {};
  const settings = task.settings || {};
  const result = task.result;
  const bitrate = settings.bitrate || {};
  const sourceDescription = source.type === "url"
    ? `${source.name || "公网视频"}${source.host ? ` · ${source.host}` : ""}`
    : source.name || "本地视频";
  const bitrateText = bitrate.mode === "exact"
    ? `${bitrate.value} kbps`
    : ({ low: "低码率", medium: "中等码率", high: "高码率" }[bitrate.value] || "码率未记录");

  return (
    <motion.article
      layout="position"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className="overflow-hidden rounded-[22px] border border-zinc-200/80 bg-white/90 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/80"
    >
      <div className="h-1 bg-[linear-gradient(90deg,#06b6d4,#38bdf8_45%,#a78bfa)] opacity-80" />
      <div className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={task.status} />
              <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
                {source.type === "url" ? <Link2 className="h-3.5 w-3.5" /> : <HardDrive className="h-3.5 w-3.5" />}
                {source.type === "url" ? "视频网址" : "本地上传"}
              </span>
            </div>
            <h3 className="mt-3 break-words text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {sourceDescription}
            </h3>
            <div className="mt-2 flex flex-wrap gap-2">
              <SettingPill>{formatResolution(settings.resolution)}</SettingPill>
              <SettingPill>{settings.fps ? `${settings.fps} fps` : "保持原帧率"}</SettingPill>
              <SettingPill>{bitrateText}</SettingPill>
            </div>
          </div>

          {DELETABLE_STATUSES.has(task.status) ? (
            <button
              type="button"
              onClick={() => onDelete(task)}
              disabled={deleting}
              className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-zinc-200 px-3 text-sm text-zinc-600 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-red-900 dark:hover:bg-red-950/30 dark:hover:text-red-300"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              删除
            </button>
          ) : (
            <span className="inline-flex h-9 shrink-0 items-center gap-1.5 self-start rounded-xl border border-zinc-200 px-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> 后台处理中
            </span>
          )}
        </div>

        {task.status === "failed" ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300">
            {task.error?.message || "这次增强未能完成，请检查原片后重新提交。"}
          </div>
        ) : null}
        {task.status === "canceled" ? (
          <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
            {task.error?.message || "任务已取消。"}
          </div>
        ) : null}

        {task.status === "completed" && result?.videoUrl ? (
          <div className="mt-4 space-y-3">
            <video
              controls
              playsInline
              preload="metadata"
              src={result.videoUrl}
              className="aspect-video w-full rounded-2xl border border-zinc-200 bg-black object-contain dark:border-zinc-800"
            >
              您的浏览器暂时无法播放这个视频。
            </video>
            <div className="flex flex-col gap-3 rounded-xl bg-zinc-50 p-3 sm:flex-row sm:items-center sm:justify-between dark:bg-zinc-900">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                {formatBytes(result.size) ? <span>{formatBytes(result.size)}</span> : null}
                {formatDuration(result.duration) ? <span>{formatDuration(result.duration)}</span> : null}
                {result.resolution ? <span>{formatResolution(result.resolution)}</span> : null}
                {result.fps ? <span>{result.fps} fps</span> : null}
              </div>
              <a
                href={result.downloadUrl}
                download
                className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-zinc-900 px-3 text-sm font-medium text-white transition-transform active:scale-[0.98] dark:bg-zinc-100 dark:text-zinc-900"
              >
                <Download className="h-4 w-4" /> 下载成片
              </a>
            </div>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-zinc-100 pt-3 text-[11px] text-zinc-400 dark:border-zinc-800">
          {formatDate(task.createdAt) ? <span>创建于 {formatDate(task.createdAt)}</span> : null}
          {formatDate(task.updatedAt) ? <span>更新于 {formatDate(task.updatedAt)}</span> : null}
        </div>
      </div>
    </motion.article>
  );
}
