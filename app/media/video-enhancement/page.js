"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Film,
  Gauge,
  Link2,
  Loader2,
  MonitorUp,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import MediaConfirmDialog from "@/app/components/media/MediaConfirmDialog";
import MediaSelect from "@/app/components/media/MediaSelect";
import VideoEnhancementTaskCard from "@/app/components/media/VideoEnhancementTaskCard";
import { useCredits } from "@/lib/client/credits/CreditContext";
import {
  abandonVideoEnhancementUpload,
  confirmVideoEnhancementUpload,
  createVideoEnhancementTask,
  deleteVideoEnhancementTask,
  listVideoEnhancementTasks,
  requestVideoEnhancementUpload,
  uploadVideoEnhancementFile,
} from "@/lib/media/client/media";
import {
  VIDEO_ENHANCEMENT_BITRATE_LEVELS,
  VIDEO_ENHANCEMENT_INPUT_EXTENSIONS,
  VIDEO_ENHANCEMENT_INPUT_MIME_TYPES_BY_EXTENSION,
  VIDEO_ENHANCEMENT_RESOLUTIONS,
  VIDEO_ENHANCEMENT_UPLOAD_MAX_BYTES,
} from "@/lib/media/shared/videoEnhancement";

const ACTIVE_STATUSES = new Set(["submitting", "running", "finalizing"]);
const DELETABLE_STATUSES = new Set(["completed", "failed", "canceled"]);
const ACCEPTED_FILES = VIDEO_ENHANCEMENT_INPUT_EXTENSIONS.map((item) => `.${item}`).join(",");

const RESOLUTION_OPTIONS = Object.freeze([
  Object.freeze({ id: "720p", label: "720p · 轻量清晰" }),
  Object.freeze({ id: "1080p", label: "1080p · 推荐" }),
  Object.freeze({ id: "2k", label: "2K · 精细输出" }),
]);

const BITRATE_OPTIONS = Object.freeze([
  Object.freeze({ id: "low", label: "低 · 更小文件" }),
  Object.freeze({ id: "medium", label: "中 · 均衡推荐" }),
  Object.freeze({ id: "high", label: "高 · 更多细节" }),
]);

const PHASE_LABELS = Object.freeze({
  ticket: "正在准备安全上传",
  upload: "原片上传中",
  confirming: "正在确认上传",
  submitting: "正在创建增强任务",
  canceling: "正在取消上传",
});

function getErrorMessage(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function getFileExtension(name) {
  const match = /\.([a-z\d]+)$/i.exec(String(name || ""));
  return match ? match[1].toLowerCase() : "";
}

function validateVideoFile(file) {
  if (!(file instanceof File)) throw new Error("请选择一个视频文件");
  const extension = getFileExtension(file.name);
  const allowedMimeTypes = VIDEO_ENHANCEMENT_INPUT_MIME_TYPES_BY_EXTENSION[extension];
  if (!allowedMimeTypes) {
    throw new Error("仅支持 MP4、FLV、TS、AVI、MOV、WMV、MKV 视频");
  }
  if (!Number.isInteger(file.size) || file.size <= 0) {
    throw new Error("所选视频是空文件，请重新选择");
  }
  if (file.size > VIDEO_ENHANCEMENT_UPLOAD_MAX_BYTES) {
    throw new Error("视频文件不能超过 5GB");
  }
  const browserMimeType = String(file.type || "").toLowerCase().split(";")[0].trim();
  if (browserMimeType && !allowedMimeTypes.includes(browserMimeType)) {
    throw new Error("视频的文件扩展名与实际类型不一致，请选择正确的文件");
  }
  return {
    extension,
    mimeType: browserMimeType || allowedMimeTypes[0],
  };
}

function validatePublicVideoUrl(value) {
  const input = String(value || "").trim();
  if (!input) throw new Error("请输入视频网址");
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error("请输入完整、有效的 HTTPS 视频网址");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || (parsed.port && parsed.port !== "443")
    || parsed.hash
  ) {
    throw new Error("视频网址必须使用 HTTPS，且不能包含账号、密码、片段或非 443 端口");
  }
  return parsed.toString();
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes >= 1024 ** 3) return `${(bytes / (1024 ** 3)).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / (1024 ** 2)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function readVideoDuration(source) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const objectUrl = source instanceof File ? URL.createObjectURL(source) : "";
    const cleanup = () => {
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("无法读取视频时长"));
    }, 10_000);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration = Number(video.duration);
      window.clearTimeout(timer);
      cleanup();
      if (!Number.isFinite(duration) || duration <= 0) {
        reject(new Error("无法读取视频时长"));
        return;
      }
      resolve(duration);
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      cleanup();
      reject(new Error("无法读取视频时长"));
    };
    video.src = objectUrl || String(source);
  });
}

export default function VideoEnhancementPage() {
  const { pricing } = useCredits();
  const [sourceType, setSourceType] = useState("upload");
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedMimeType, setSelectedMimeType] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [sourceDurationSeconds, setSourceDurationSeconds] = useState("");
  const [resolution, setResolution] = useState("1080p");
  const [fpsMode, setFpsMode] = useState("original");
  const [fpsValue, setFpsValue] = useState("30");
  const [bitrateMode, setBitrateMode] = useState("level");
  const [bitrateLevel, setBitrateLevel] = useState("medium");
  const [exactBitrate, setExactBitrate] = useState("8000");
  const [phase, setPhase] = useState("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [formError, setFormError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [tasks, setTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [deletingTaskId, setDeletingTaskId] = useState("");

  const mountedRef = useRef(false);
  const fileInputRef = useRef(null);
  const uploadAbortRef = useRef(null);
  const uploadTicketIdRef = useRef("");
  const uploadTicketCleanupPromisesRef = useRef(new Map());
  const submittingRef = useRef(false);
  const taskListRequestRef = useRef(false);
  const cancelReasonRef = useRef("");

  const isSubmitting = phase !== "idle";
  const hasActiveTasks = useMemo(
    () => tasks.some((task) => ACTIVE_STATUSES.has(task.status)),
    [tasks],
  );

  const abandonTicket = useCallback((ticketId) => {
    if (!ticketId) return Promise.resolve(false);
    const existing = uploadTicketCleanupPromisesRef.current.get(ticketId);
    if (existing) return existing;

    const cleanupPromise = abandonVideoEnhancementUpload(ticketId);
    uploadTicketCleanupPromisesRef.current.set(ticketId, cleanupPromise);
    void cleanupPromise.catch(() => {});
    return cleanupPromise;
  }, []);

  const clearPendingUpload = useCallback((reason) => {
    cancelReasonRef.current = reason;
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
    const ticketId = uploadTicketIdRef.current;
    uploadTicketIdRef.current = "";
    if (!ticketId) return Promise.resolve(false);
    return abandonTicket(ticketId);
  }, [abandonTicket]);

  const loadTasks = useCallback(async ({ initial = false, silent = false } = {}) => {
    if (taskListRequestRef.current) return;
    taskListRequestRef.current = true;
    if (mountedRef.current) {
      if (initial) setTasksLoading(true);
      if (!initial && !silent) setRefreshing(true);
      if (!silent) setHistoryError("");
    }
    try {
      const nextTasks = await listVideoEnhancementTasks();
      if (mountedRef.current) setTasks(nextTasks);
    } catch (error) {
      if (mountedRef.current && !silent) {
        setHistoryError(getErrorMessage(error, "读取任务记录失败"));
      }
    } finally {
      taskListRequestRef.current = false;
      if (mountedRef.current) {
        setTasksLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const timer = window.setTimeout(() => loadTasks({ initial: true }), 0);
    return () => {
      mountedRef.current = false;
      window.clearTimeout(timer);
      clearPendingUpload("unmount");
    };
  }, [clearPendingUpload, loadTasks]);

  useEffect(() => {
    if (!hasActiveTasks) return undefined;
    const timer = window.setInterval(() => loadTasks({ silent: true }), 15_000);
    return () => window.clearInterval(timer);
  }, [hasActiveTasks, loadTasks]);

  const chooseSource = (nextSourceType) => {
    if (nextSourceType === sourceType || phase === "submitting") return;
    if (isSubmitting) clearPendingUpload("switch");
    setSourceType(nextSourceType);
    setSourceDurationSeconds("");
    setFormError("");
    setSuccessMessage("");
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0] || null;
    setFormError("");
    setSuccessMessage("");
    if (!file) {
      setSelectedFile(null);
      setSelectedMimeType("");
      setSourceDurationSeconds("");
      return;
    }
    try {
      const metadata = validateVideoFile(file);
      setSelectedFile(file);
      setSelectedMimeType(metadata.mimeType);
      const duration = await readVideoDuration(file);
      if (duration < 1 || duration > 60) {
        throw new Error("原片时长必须在 1 到 60 秒之间");
      }
      setSourceDurationSeconds(String(Math.ceil(duration)));
    } catch (error) {
      event.target.value = "";
      setSelectedFile(null);
      setSelectedMimeType("");
      setSourceDurationSeconds("");
      setFormError(getErrorMessage(error, "无法使用这个视频文件"));
    }
  };

  const removeSelectedFile = () => {
    setSelectedFile(null);
    setSelectedMimeType("");
    setSourceDurationSeconds("");
    setFormError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleCancelUpload = () => {
    if (!isSubmitting || phase === "submitting") return;
    setPhase("canceling");
    clearPendingUpload("user");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submittingRef.current) return;

    let source;
    let fileMetadata = null;
    try {
      if (!VIDEO_ENHANCEMENT_RESOLUTIONS.includes(resolution)) {
        throw new Error("请选择输出分辨率");
      }
      if (fpsMode === "exact") {
        const fps = Number(fpsValue);
        if (!Number.isInteger(fps) || fps < 15 || fps > 120) {
          throw new Error("目标帧率必须是 15 到 120 之间的整数");
        }
      }
      if (bitrateMode === "level") {
        if (!VIDEO_ENHANCEMENT_BITRATE_LEVELS.includes(bitrateLevel)) {
          throw new Error("请选择码率档位");
        }
      } else {
        const bitrate = Number(exactBitrate);
        if (!Number.isInteger(bitrate) || bitrate < 10 || bitrate > 150000) {
          throw new Error("精确码率必须是 10 到 150000 之间的整数");
        }
      }
      if (sourceType === "upload") {
        if (!selectedFile) throw new Error("请先选择需要增强的视频");
        fileMetadata = validateVideoFile(selectedFile);
      } else {
        source = { type: "url", url: validatePublicVideoUrl(urlInput) };
      }
      const duration = Number(sourceDurationSeconds);
      if (!Number.isInteger(duration) || duration < 1 || duration > 60) {
        throw new Error("请填写 1 到 60 秒之间的原片时长");
      }
    } catch (error) {
      setFormError(getErrorMessage(error, "请检查填写内容"));
      return;
    }

    submittingRef.current = true;
    cancelReasonRef.current = "";
    setFormError("");
    setSuccessMessage("");
    setUploadProgress(0);
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    let uploadId = "";
    let taskSubmissionStarted = false;

    try {
      if (sourceType === "upload") {
        setPhase("ticket");
        const upload = await requestVideoEnhancementUpload({
          originalName: selectedFile.name,
          size: selectedFile.size,
          mimeType: fileMetadata.mimeType,
        }, { signal: controller.signal });
        uploadId = upload.id;
        uploadTicketIdRef.current = uploadId;
        if (controller.signal.aborted) throw new DOMException("视频上传已取消", "AbortError");

        setPhase("upload");
        await uploadVideoEnhancementFile(selectedFile, upload, {
          signal: controller.signal,
          onProgress: (value) => {
            if (mountedRef.current) setUploadProgress(value);
          },
        });
        if (controller.signal.aborted) throw new DOMException("视频上传已取消", "AbortError");

        setPhase("confirming");
        await confirmVideoEnhancementUpload(uploadId, { signal: controller.signal });
        if (controller.signal.aborted) throw new DOMException("视频上传已取消", "AbortError");
        source = { type: "upload", uploadTicketId: uploadId };
      }

      const input = {
        source,
        resolution,
        bitrate: bitrateMode === "level"
          ? { mode: "level", value: bitrateLevel }
          : { mode: "exact", value: Number(exactBitrate) },
        ...(fpsMode === "exact" ? { fps: Number(fpsValue) } : {}),
        sourceDurationSeconds: Number(sourceDurationSeconds),
      };

      setPhase("submitting");
      uploadAbortRef.current = null;
      uploadTicketIdRef.current = "";
      taskSubmissionStarted = true;
      const task = await createVideoEnhancementTask(input);
      uploadId = "";
      if (mountedRef.current) {
        setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
        setSuccessMessage("任务已开始。关闭页面也会继续处理，可稍后回来查看结果。");
        if (sourceType === "upload") removeSelectedFile();
        if (sourceType === "url") setUrlInput("");
      }
    } catch (error) {
      let cleanupFailed = false;
      if (uploadId) {
        if (uploadTicketIdRef.current === uploadId) uploadTicketIdRef.current = "";
        try {
          await abandonTicket(uploadId);
        } catch {
          cleanupFailed = true;
        }
      }
      if (mountedRef.current) {
        if (taskSubmissionStarted) void loadTasks({ silent: true });
        const cancelReason = cancelReasonRef.current;
        if (cleanupFailed && cancelReason === "user") {
          setFormError("上传已取消，但临时上传凭证未能清理。请稍后再提交。");
        } else if (cleanupFailed && cancelReason === "switch") {
          setFormError("视频来源已切换，但上一次的临时上传凭证未能清理。请稍后再提交。");
        } else if (cleanupFailed) {
          setFormError("提交未完成，临时上传凭证也未能清理。请稍后刷新记录再重新提交。");
        } else if (error?.name === "AbortError") {
          if (cancelReason === "user") setFormError("上传已取消，原片不会继续上传。");
        } else {
          setFormError(getErrorMessage(error, "提交失败，请检查后重新提交"));
        }
      }
    } finally {
      if (uploadAbortRef.current === controller) uploadAbortRef.current = null;
      submittingRef.current = false;
      if (mountedRef.current) setPhase("idle");
    }
  };

  const handleDeleteTask = async () => {
    const task = deleteCandidate;
    if (!task || !DELETABLE_STATUSES.has(task.status) || deletingTaskId) return;
    setDeleteCandidate(null);
    setDeletingTaskId(task.id);
    setHistoryError("");
    try {
      await deleteVideoEnhancementTask(task.id);
      if (mountedRef.current) {
        setTasks((current) => current.filter((item) => item.id !== task.id));
      }
    } catch (error) {
      if (mountedRef.current) {
        setHistoryError(getErrorMessage(error, "删除任务失败"));
      }
    } finally {
      if (mountedRef.current) setDeletingTaskId("");
    }
  };

  return (
    <div className="space-y-8 pb-10">
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-[28px] border border-cyan-200/60 bg-[linear-gradient(135deg,rgba(236,254,255,0.96),rgba(255,255,255,0.94)_48%,rgba(245,243,255,0.92))] p-5 shadow-sm sm:p-7 dark:border-cyan-900/50 dark:bg-[linear-gradient(135deg,rgba(8,47,73,0.46),rgba(9,9,11,0.96)_48%,rgba(46,16,101,0.30))]"
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage: "linear-gradient(rgba(14,116,144,.8) 1px,transparent 1px),linear-gradient(90deg,rgba(14,116,144,.8) 1px,transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-cyan-300/25 blur-3xl dark:bg-cyan-500/10" />
        <div className="relative grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-white/70 px-3 py-1.5 text-xs font-semibold tracking-[0.12em] text-cyan-800 backdrop-blur dark:border-cyan-900 dark:bg-zinc-950/60 dark:text-cyan-300">
              <ScanLine className="h-3.5 w-3.5" /> VIDEO RESTORATION LAB
            </div>
            <h1 className="max-w-2xl text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl dark:text-white">
              视频修复实验台
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-600 sm:text-base dark:text-zinc-300">
              提升画面清晰度、细节与观感。提交后在后台持续处理，关闭页面也不会中断任务。
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center md:w-72">
            {[['01', '选原片'], ['02', '设画质'], ['03', '等成片']].map(([step, label]) => (
              <div key={step} className="rounded-2xl border border-white/80 bg-white/65 px-2 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/55">
                <div className="font-mono text-xs text-cyan-600 dark:text-cyan-400">{step}</div>
                <div className="mt-1 text-xs font-medium text-zinc-700 dark:text-zinc-300">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </motion.section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(280px,.75fr)] lg:items-start">
        <form onSubmit={handleSubmit} className="space-y-5 rounded-[24px] border border-zinc-200/80 bg-white p-5 shadow-sm sm:p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-100 text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300">
              <Film className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-semibold">输入原片</h2>
              <p className="text-xs text-zinc-500">选择本地文件或填写可公开访问的视频网址</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-2xl bg-zinc-100 p-1 dark:bg-zinc-900" role="group" aria-label="视频来源">
            <button
              type="button"
              aria-pressed={sourceType === "upload"}
              disabled={phase === "submitting"}
              onClick={() => chooseSource("upload")}
              className={`flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-60 ${sourceType === "upload" ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-white" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}
            >
              <Upload className="h-4 w-4" /> 本地上传
            </button>
            <button
              type="button"
              aria-pressed={sourceType === "url"}
              disabled={phase === "submitting"}
              onClick={() => chooseSource("url")}
              className={`flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-60 ${sourceType === "url" ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-white" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}
            >
              <Link2 className="h-4 w-4" /> 视频网址
            </button>
          </div>

          {sourceType === "upload" ? (
            selectedFile ? (
              <div className="flex items-center gap-3 rounded-2xl border border-cyan-200 bg-cyan-50/60 p-4 dark:border-cyan-900/70 dark:bg-cyan-950/20">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-cyan-700 shadow-sm dark:bg-zinc-900 dark:text-cyan-300">
                  <Film className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={selectedFile.name}>{selectedFile.name}</p>
                  <p className="mt-1 text-xs text-zinc-500">{formatBytes(selectedFile.size)} · {selectedMimeType}</p>
                </div>
                <button
                  type="button"
                  onClick={removeSelectedFile}
                  disabled={isSubmitting}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-white hover:text-zinc-700 disabled:opacity-40 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
                  aria-label="移除所选视频"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <label className="relative flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/70 px-5 text-center transition-colors hover:border-cyan-400 hover:bg-cyan-50/40 focus-within:border-cyan-500 focus-within:ring-2 focus-within:ring-cyan-500/20 dark:border-zinc-700 dark:bg-zinc-900/60 dark:hover:border-cyan-700 dark:hover:bg-cyan-950/20">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_FILES}
                  disabled={isSubmitting}
                  onChange={handleFileChange}
                  className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
                  aria-label="选择需要增强的视频文件"
                />
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-cyan-700 shadow-sm dark:bg-zinc-800 dark:text-cyan-300">
                  <MonitorUp className="h-6 w-6" />
                </span>
                <span className="mt-3 text-sm font-semibold">点击选择原片</span>
                <span className="mt-1 text-xs leading-5 text-zinc-500">MP4、FLV、TS、AVI、MOV、WMV、MKV，最大 5GB</span>
              </label>
            )
          ) : (
            <div>
              <label htmlFor="video-enhancement-url" className="mb-2 block text-sm font-medium">视频网址</label>
              <div className="relative">
                <Link2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input
                  id="video-enhancement-url"
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  value={urlInput}
                  onChange={(event) => {
                    setUrlInput(event.target.value);
                    setSourceDurationSeconds("");
                    setFormError("");
                    setSuccessMessage("");
                  }}
                  onBlur={async () => {
                    if (!urlInput.trim() || sourceDurationSeconds) return;
                    try {
                      const safeUrl = validatePublicVideoUrl(urlInput);
                      const duration = await readVideoDuration(safeUrl);
                      if (duration >= 1 && duration <= 60 && mountedRef.current) {
                        setSourceDurationSeconds(String(Math.ceil(duration)));
                      }
                    } catch {
                      // 公网地址无法可靠读取元数据时，由用户填写时长。
                    }
                  }}
                  disabled={isSubmitting}
                  placeholder="https://example.com/video.mp4"
                  className="h-12 w-full rounded-xl border border-zinc-200 bg-white pl-10 pr-3 text-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </div>
              <p className="mt-2 text-xs leading-5 text-zinc-500">仅支持公开的 HTTPS 地址，不能带账号密码、网址片段或特殊端口。</p>
            </div>
          )}

          <div>
            <label htmlFor="video-enhancement-duration" className="mb-2 block text-sm font-medium">原片时长（秒）</label>
            <input
              id="video-enhancement-duration"
              type="number"
              min="1"
              max="60"
              step="1"
              value={sourceDurationSeconds}
              onChange={(event) => setSourceDurationSeconds(event.target.value)}
              readOnly={sourceType === "upload"}
              disabled={isSubmitting}
              placeholder={sourceType === "upload" ? "选择文件后自动读取" : "无法自动读取时请手动填写"}
              className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/15 read-only:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:read-only:bg-zinc-950"
            />
            <p className="mt-2 text-xs text-zinc-500">仅支持 1 到 60 秒；网址无法自动读取时需要手动填写。</p>
          </div>

          <div className="border-t border-zinc-100 pt-5 dark:border-zinc-800">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
                <Gauge className="h-5 w-5" />
              </span>
              <div>
                <h2 className="font-semibold">输出画质</h2>
                <p className="text-xs text-zinc-500">默认保持原帧率，并采用均衡码率</p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="enhancement-resolution" className="mb-2 block text-sm font-medium">目标分辨率</label>
                <MediaSelect
                  id="enhancement-resolution"
                  value={resolution}
                  onChange={setResolution}
                  options={RESOLUTION_OPTIONS}
                  disabled={isSubmitting}
                  size="lg"
                  ariaLabel="选择目标分辨率"
                />
              </div>
              <div>
                <span className="mb-2 block text-sm font-medium">目标帧率</span>
                <div className="grid grid-cols-2 gap-2" role="group" aria-label="目标帧率方式">
                  <button
                    type="button"
                    aria-pressed={fpsMode === "original"}
                    disabled={isSubmitting}
                    onClick={() => setFpsMode("original")}
                    className={`h-11 rounded-xl border text-sm transition-colors disabled:opacity-60 ${fpsMode === "original" ? "border-cyan-500 bg-cyan-50 font-medium text-cyan-700 dark:bg-cyan-950/30 dark:text-cyan-300" : "border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-300"}`}
                  >
                    保持原片
                  </button>
                  <button
                    type="button"
                    aria-pressed={fpsMode === "exact"}
                    disabled={isSubmitting}
                    onClick={() => setFpsMode("exact")}
                    className={`h-11 rounded-xl border text-sm transition-colors disabled:opacity-60 ${fpsMode === "exact" ? "border-cyan-500 bg-cyan-50 font-medium text-cyan-700 dark:bg-cyan-950/30 dark:text-cyan-300" : "border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-300"}`}
                  >
                    自定义
                  </button>
                </div>
              </div>
            </div>

            {fpsMode === "exact" ? (
              <div className="mt-3 sm:ml-auto sm:w-[calc(50%-0.5rem)]">
                <label htmlFor="enhancement-fps" className="mb-2 block text-xs font-medium text-zinc-500">15–120 的整数</label>
                <div className="relative">
                  <input
                    id="enhancement-fps"
                    type="number"
                    min="15"
                    max="120"
                    step="1"
                    value={fpsValue}
                    onChange={(event) => setFpsValue(event.target.value)}
                    disabled={isSubmitting}
                    className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 pr-12 text-sm outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/15 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400">fps</span>
                </div>
              </div>
            ) : null}

            <div className="mt-5 rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">高级码率</h3>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">档位适合大多数视频；精确值适合已有明确输出要求的情况。</p>
                </div>
                <Sparkles className="h-4 w-4 shrink-0 text-violet-500" />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="码率方式">
                <button
                  type="button"
                  aria-pressed={bitrateMode === "level"}
                  disabled={isSubmitting}
                  onClick={() => setBitrateMode("level")}
                  className={`h-10 rounded-xl text-sm font-medium transition-colors disabled:opacity-60 ${bitrateMode === "level" ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-white text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300"}`}
                >
                  码率档位
                </button>
                <button
                  type="button"
                  aria-pressed={bitrateMode === "exact"}
                  disabled={isSubmitting}
                  onClick={() => setBitrateMode("exact")}
                  className={`h-10 rounded-xl text-sm font-medium transition-colors disabled:opacity-60 ${bitrateMode === "exact" ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-white text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300"}`}
                >
                  精确码率
                </button>
              </div>
              <div className="mt-3">
                {bitrateMode === "level" ? (
                  <MediaSelect
                    value={bitrateLevel}
                    onChange={setBitrateLevel}
                    options={BITRATE_OPTIONS}
                    disabled={isSubmitting}
                    ariaLabel="选择码率档位"
                  />
                ) : (
                  <div>
                    <label htmlFor="enhancement-bitrate" className="sr-only">精确码率</label>
                    <div className="relative">
                      <input
                        id="enhancement-bitrate"
                        type="number"
                        min="10"
                        max="150000"
                        step="1"
                        value={exactBitrate}
                        onChange={(event) => setExactBitrate(event.target.value)}
                        disabled={isSubmitting}
                        className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 pr-16 text-sm outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/15 dark:border-zinc-700 dark:bg-zinc-900"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400">kbps</span>
                    </div>
                    <p className="mt-2 text-xs text-zinc-500">可填写 10–150000 的整数，与码率档位二选一。</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div aria-live="polite" className="space-y-3">
            {formError ? (
              <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {formError}
              </div>
            ) : null}
            {successMessage ? (
              <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-300">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {successMessage}
              </div>
            ) : null}
          </div>

          {isSubmitting ? (
            <div className="rounded-2xl border border-cyan-200 bg-cyan-50/60 p-4 dark:border-cyan-900/70 dark:bg-cyan-950/20" aria-live="polite">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="inline-flex items-center gap-2 font-medium text-cyan-800 dark:text-cyan-200">
                  <Loader2 className="h-4 w-4 animate-spin" /> {PHASE_LABELS[phase] || "正在处理"}
                </span>
                {phase === "upload" ? <span className="font-mono text-xs text-cyan-700 dark:text-cyan-300">{uploadProgress}%</span> : null}
              </div>
              {phase === "upload" ? (
                <div
                  className="mt-3 h-2 overflow-hidden rounded-full bg-cyan-100 dark:bg-cyan-950"
                  role="progressbar"
                  aria-label="视频上传进度"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  aria-valuenow={uploadProgress}
                >
                  <div className="h-full rounded-full bg-cyan-500 transition-[width]" style={{ width: `${uploadProgress}%` }} />
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col-reverse gap-3 sm:flex-row">
            {isSubmitting && phase !== "submitting" ? (
              <button
                type="button"
                onClick={handleCancelUpload}
                disabled={phase === "canceling"}
                className="h-12 rounded-xl border border-zinc-200 px-5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 sm:w-36 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                取消上传
              </button>
            ) : null}
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(100deg,#0891b2,#0284c7_52%,#7c3aed)] px-5 text-sm font-semibold text-white shadow-lg shadow-cyan-500/15 transition-[transform,filter] hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}
              {isSubmitting ? PHASE_LABELS[phase] || "正在提交" : "开始画质增强"}
            </button>
          </div>
          {Number.isInteger(pricing?.mediaKit?.perMinute) ? (
            <p className="text-center text-xs text-zinc-500">普通用户统一按 60 秒上限冻结 {pricing.mediaKit.perMinute.toLocaleString("zh-CN")} 积分，完成后按结果时长退回差额</p>
          ) : null}
        </form>

        <aside className="space-y-4 lg:sticky lg:top-24">
          <section className="rounded-[24px] border border-zinc-200/80 bg-zinc-950 p-5 text-zinc-100 shadow-sm dark:border-zinc-800">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="h-4 w-4 text-cyan-400" /> 原片与处理范围
            </div>
            <div className="mt-4 space-y-3 text-sm leading-6 text-zinc-300">
              <p>Vectaix 不保存原片。原片由火山临时保存，最长不超过 30 天。</p>
              <div className="h-px bg-zinc-800" />
              <p>输入最高 1080p，仅支持 SDR。短边需在 360–1080 像素，长边需在 360–1920 像素。</p>
              <div className="h-px bg-zinc-800" />
              <p>支持 MP4、FLV、TS、AVI、MOV、WMV、MKV，单个文件最大 5GB。</p>
            </div>
          </section>

          <section className="rounded-[24px] border border-zinc-200/80 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Clock3 className="h-4 w-4 text-violet-500" /> 处理时间
            </div>
            <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
              平均约需视频时长的 15–20 倍。视频越长、输出画质越高，等待时间通常越久。
            </p>
            <div className="mt-4 rounded-xl bg-violet-50 px-3.5 py-3 text-xs leading-5 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300">
              提交成功后可放心关闭页面，任务会继续进行。
            </div>
          </section>
        </aside>
      </div>

      <section aria-labelledby="enhancement-history-title" className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.14em] text-cyan-600 dark:text-cyan-400">TASK ARCHIVE</p>
            <h2 id="enhancement-history-title" className="mt-1 text-xl font-semibold">增强记录</h2>
            <p className="mt-1 text-sm text-zinc-500">运行中的任务每 15 秒统一更新一次。</p>
          </div>
          <button
            type="button"
            onClick={() => loadTasks()}
            disabled={refreshing || tasksLoading}
            className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> 刷新全部
          </button>
        </div>

        {historyError ? (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300" role="alert">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {historyError}
          </div>
        ) : null}

        {tasksLoading ? (
          <div className="flex min-h-40 items-center justify-center rounded-[22px] border border-zinc-200/80 bg-white text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 正在读取增强记录
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center rounded-[22px] border border-dashed border-zinc-300 bg-zinc-50/50 px-5 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
            <Film className="h-8 w-8 text-zinc-300 dark:text-zinc-600" />
            <p className="mt-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">还没有增强记录</p>
            <p className="mt-1 text-xs text-zinc-500">提交第一段视频后，进度与成片会显示在这里。</p>
          </div>
        ) : (
          <div className="grid gap-4">
            <AnimatePresence initial={false}>
              {tasks.map((task) => (
                <VideoEnhancementTaskCard
                  key={task.id}
                  task={task}
                  deleting={deletingTaskId === task.id}
                  onDelete={setDeleteCandidate}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </section>

      <MediaConfirmDialog
        open={Boolean(deleteCandidate)}
        onClose={() => setDeleteCandidate(null)}
        onConfirm={handleDeleteTask}
        title="删除这条增强记录？"
        message="记录和已经保存的成片会一起删除，删除后无法恢复。"
        confirmText="确认删除"
        danger
      />
    </div>
  );
}
