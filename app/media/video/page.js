'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import NextImage from 'next/image';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  CheckCircle2,
  Clapperboard,
  Clock3,
  Download,
  ImagePlus,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import ConfirmModal from '@/app/components/modals/ConfirmModal';
import {
  createVideoTask,
  deleteVideoTask,
  getVideoTask,
  listVideoTasks,
} from '@/lib/media/client/media';
import {
  VIDEO_ASPECT_RATIO_OPTIONS,
  VIDEO_DURATION_OPTIONS,
  VIDEO_FRAME_ACCEPTED_MIME_TYPES,
  VIDEO_FRAME_MAX_BYTES,
  VIDEO_MODEL_NAME,
  VIDEO_PROMPT_MAX_LENGTH,
  VIDEO_RESOLUTION_OPTIONS,
} from '@/lib/media/shared/models';

const ACTIVE_STATUSES = new Set(['queued', 'in_progress']);
const DELETABLE_STATUSES = new Set(['queued', 'completed', 'failed']);
const VIDEO_FRAME_MAX_MB = Math.round(VIDEO_FRAME_MAX_BYTES / (1024 * 1024));

const STATUS_LABELS = {
  queued: '排队中',
  in_progress: '生成中',
  completed: '已完成',
  failed: '失败',
};

const STATUS_STYLES = {
  queued: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300',
  in_progress: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-300',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300',
  failed: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300',
};

const STALE_TASK_MS = 10 * 60 * 1000;

function isAcceptedFrame(file) {
  return VIDEO_FRAME_ACCEPTED_MIME_TYPES.includes(file.type);
}

function getErrorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatDuration(value) {
  if (value === undefined || value === null || value === '') return '5 秒';
  return Number(value) === -1 ? '智能时长' : `${value} 秒`;
}

function formatTokens(task) {
  const total = Number(task?.usage?.total_tokens ?? task?.upstream?.usage?.total_tokens);
  if (!Number.isFinite(total) || total <= 0) return '';
  return `用量 ${total.toLocaleString('zh-CN')}`;
}

function formatRatio(value) {
  if (!value || value === 'adaptive') return '自适应比例';
  return VIDEO_ASPECT_RATIO_OPTIONS.find((option) => option.id === value)?.label || value;
}

function getTaskError(task) {
  if (typeof task?.error?.message === 'string') return task.error.message;
  if (typeof task?.error?.code === 'string') return task.error.code;
  return '';
}

function mergeTask(tasks, nextTask) {
  if (!nextTask?.id) return tasks;
  const exists = tasks.some((task) => task.id === nextTask.id);
  if (!exists) return [nextTask, ...tasks];
  return tasks.map((task) => (task.id === nextTask.id ? nextTask : task));
}

function TaskStatus({ status }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.queued;
  const label = STATUS_LABELS[status] || status || '排队中';
  const Icon = status === 'completed' ? CheckCircle2 : status === 'failed' ? AlertTriangle : status === 'in_progress' ? Loader2 : Clock3;
  return (
    <span className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium ${style}`}>
      <Icon className={`h-3.5 w-3.5 ${status === 'in_progress' ? 'animate-spin' : ''}`} />
      {label}
    </span>
  );
}

function VideoTaskCard({ task, acting, stale, onRefresh, onDelete }) {
  const params = task.params || {};
  const createdAt = formatDate(task.createdAt);
  const tokens = formatTokens(task);
  const errorText = getTaskError(task);
  const canDelete = DELETABLE_STATUSES.has(task.status);
  const isActive = ACTIVE_STATUSES.has(task.status);
  const isStale = Boolean(stale);
  const title = task.inputMode === 'image' ? '参考图生成视频' : '文字生成视频';

  return (
    <motion.article
      layout="position"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.15 } }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="rounded-2xl border border-zinc-200/70 bg-white/80 p-4 shadow-sm dark:border-zinc-800/70 dark:bg-zinc-950/70"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <TaskStatus status={task.status} />
            <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{title}</span>
          </div>
          <p className="line-clamp-2 text-sm text-zinc-600 dark:text-zinc-300">
            {task.prompt || '仅使用图片生成'}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
            <span>{formatRatio(params.ratio)}</span>
            <span>{formatDuration(params.duration)}</span>
            <span>{params.resolution || '720p'}</span>
            <span>{params.generateAudio ? '有声' : '无声'}</span>
            {params.watermark ? <span>带水印</span> : null}
            {tokens ? <span>{tokens}</span> : null}
            {createdAt ? <span>{createdAt}</span> : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => onRefresh(task.id)}
            disabled={acting}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            aria-label="刷新任务"
            title="刷新任务"
          >
            <RefreshCw className={`h-4 w-4 ${acting ? 'animate-spin' : ''}`} />
          </button>
          {canDelete ? (
            <button
              type="button"
              onClick={() => onDelete(task)}
              disabled={acting}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <Trash2 className="h-4 w-4" />
              删除
            </button>
          ) : (
            <button
              type="button"
              disabled
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-sm text-zinc-400 dark:border-zinc-800 dark:text-zinc-500"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              运行中
            </button>
          )}
        </div>
      </div>

      {isStale ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
          任务耗时较长，可能仍在排队。可点击右上角刷新按钮手动同步状态。
        </div>
      ) : null}

      {errorText ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
          {errorText}
        </div>
      ) : null}

      {task.videoUrl ? (
        <div className="mt-4 space-y-3">
          <video
            controls
            playsInline
            className="w-full overflow-hidden rounded-xl border border-zinc-200 bg-zinc-950 dark:border-zinc-700"
            src={task.videoUrl}
          >
            您的浏览器不支持视频播放。
          </video>
          <div className="flex flex-wrap items-center gap-3">
            <a href={task.videoUrl} download className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
              <Download className="h-4 w-4" />
              下载视频
            </a>
          </div>
        </div>
      ) : null}
    </motion.article>
  );
}

export default function VideoGenerationPage() {
  const [mode, setMode] = useState('text');
  const [prompt, setPrompt] = useState('');
  const [ratio, setRatio] = useState('adaptive');
  const [duration, setDuration] = useState(5);
  const [resolution, setResolution] = useState('720p');
  const [generateAudio, setGenerateAudio] = useState(true);
  const [watermark, setWatermark] = useState(false);
  const [image, setImage] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState('');
  const [imageInputKey, setImageInputKey] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [actingTaskId, setActingTaskId] = useState('');
  const [error, setError] = useState('');
  const [tasks, setTasks] = useState([]);
  const [deleteConfirmTask, setDeleteConfirmTask] = useState(null);
  const [staleTaskIds, setStaleTaskIds] = useState(() => new Set());

  const activeTaskKey = useMemo(
    () => tasks
      .filter((task) => ACTIVE_STATUSES.has(task.status))
      .map((task) => task.id)
      .join('|'),
    [tasks]
  );

  useEffect(() => () => {
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
  }, [imagePreviewUrl]);

  const loadTasks = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setTasksLoading(true);
    try {
      const nextTasks = await listVideoTasks();
      setTasks(nextTasks);
    } catch (loadError) {
      if (!silent) setError(getErrorMessage(loadError, '读取视频任务失败'));
    } finally {
      if (!silent) setTasksLoading(false);
    }
  }, []);

  const refreshTask = useCallback(async (taskId) => {
    if (!taskId) return;
    try {
      const nextTask = await getVideoTask(taskId);
      setTasks((current) => mergeTask(current, nextTask));
    } catch (refreshError) {
      setError(getErrorMessage(refreshError, '刷新任务失败'));
    }
  }, []);

  const refreshActiveTasks = useCallback(async () => {
    const activeTaskIds = activeTaskKey ? activeTaskKey.split('|').filter(Boolean) : [];
    if (activeTaskIds.length === 0) return;
    const results = await Promise.allSettled(activeTaskIds.map((taskId) => getVideoTask(taskId)));
    const nextTasks = results
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value);
    if (nextTasks.length > 0) {
      setTasks((current) => nextTasks.reduce((acc, task) => mergeTask(acc, task), current));
    }
  }, [activeTaskKey]);

  useEffect(() => {
    const timer = setTimeout(() => loadTasks(), 0);
    return () => clearTimeout(timer);
  }, [loadTasks]);

  useEffect(() => {
    if (!activeTaskKey) return undefined;
    const initialTimer = setTimeout(() => refreshActiveTasks(), 0);
    const timer = setInterval(refreshActiveTasks, 15_000);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(timer);
    };
  }, [activeTaskKey, refreshActiveTasks]);

  // 标记耗时过长的任务（在 effect 中计算，避免渲染期调用 Date.now）
  useEffect(() => {
    const computeStale = () => {
      const now = Date.now();
      setStaleTaskIds(new Set(
        tasks
          .filter((task) => ACTIVE_STATUSES.has(task.status) && task.createdAt && (now - new Date(task.createdAt).getTime() > STALE_TASK_MS))
          .map((task) => task.id)
      ));
    };
    computeStale();
    const timer = setInterval(computeStale, 60_000);
    return () => clearInterval(timer);
  }, [tasks]);

  const handleFrameChange = (_kind, file) => {
    setError('');
    setImage(file);
    setImagePreviewUrl(file ? URL.createObjectURL(file) : '');
    if (!file) setImageInputKey((current) => current + 1);
  };

  const validateFrame = (file, label) => {
    if (!file) return '';
    if (!isAcceptedFrame(file)) return `${label}仅支持 PNG、JPG、WEBP 图片`;
    if (file.size > VIDEO_FRAME_MAX_BYTES) return `${label}大小不能超过 ${VIDEO_FRAME_MAX_MB}MB`;
    return '';
  };

  const renderFramePicker = ({ kind, label, file, previewUrl, inputKey }) => (
    <div className="space-y-2">
      <label htmlFor={`video-${kind}`} className="text-sm font-medium">{label}</label>
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900">
        <div className="relative min-h-[130px]">
          <label htmlFor={`video-${kind}`} className="flex min-h-[130px] cursor-pointer flex-col items-center justify-center px-4 py-5 text-center text-sm text-zinc-500">
            {previewUrl ? <NextImage src={previewUrl} alt={label} width={512} height={156} unoptimized className="h-[156px] w-full object-contain" /> : (
              <>
                <Upload className="mb-2 h-6 w-6" />
                <span className="font-medium">{file ? file.name : '上传 PNG、JPG 或 WEBP'}</span>
                <span className="mt-1 text-xs">最大 {VIDEO_FRAME_MAX_MB}MB</span>
              </>
            )}
          </label>
          {previewUrl ? (
            <button type="button" onClick={() => handleFrameChange(kind, null)} className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white" aria-label={`移除${label}`}>
              <X className="h-4 w-4" />
            </button>
          ) : null}
          <input key={inputKey} id={`video-${kind}`} type="file" accept={VIDEO_FRAME_ACCEPTED_MIME_TYPES.join(',')} className="sr-only" onChange={(event) => handleFrameChange(kind, event.target.files?.[0] || null)} />
        </div>
      </div>
    </div>
  );

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (mode === 'text' && !prompt.trim()) {
      setError('请输入视频描述');
      return;
    }
    if (mode === 'image' && !image) {
      setError('请上传参考图片');
      return;
    }
    if (prompt.trim().length > VIDEO_PROMPT_MAX_LENGTH) {
      setError(`视频描述最多支持 ${VIDEO_PROMPT_MAX_LENGTH} 个字符`);
      return;
    }
    const imageError = validateFrame(mode === 'image' ? image : null, '参考图片');
    if (imageError) { setError(imageError); return; }
    setIsSubmitting(true);
    try {
      const task = await createVideoTask({
        prompt: prompt.trim(),
        ratio,
        duration,
        resolution,
        image: mode === 'image' ? image : null,
        generateAudio,
        watermark,
      });
      setTasks((current) => mergeTask(current, task));
      setPrompt('');
      setImage(null);
      setImageInputKey((current) => current + 1);
    } catch (submitError) {
      setError(getErrorMessage(submitError, '视频任务创建失败，请稍后再试'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteTask = async () => {
    const task = deleteConfirmTask;
    setDeleteConfirmTask(null);
    if (!task) return;
    setError('');
    setActingTaskId(task.id);
    try {
      const result = await deleteVideoTask(task.id);
      if (result.deleted) {
        setTasks((current) => current.filter((item) => item.id !== task.id));
      } else if (result.task) {
        setTasks((current) => mergeTask(current, result.task));
      }
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, '处理视频任务失败'));
    } finally {
      setActingTaskId('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="glass-effect rounded-2xl border border-zinc-200/60 p-5 dark:border-zinc-800/60">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Clapperboard className="h-5 w-5" /></span>
          <div>
            <h2 className="text-lg font-semibold">视频生成</h2>
            <p className="text-sm text-zinc-500">使用 {VIDEO_MODEL_NAME}，创建视频任务并自动同步结果。</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <AnimatePresence initial={false}>
            {error ? (
              <motion.div
                key="video-form-error"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <div className="relative grid grid-cols-2 gap-2 rounded-xl border border-zinc-200 bg-zinc-100/70 p-1 dark:border-zinc-700 dark:bg-zinc-900/70">
            <button type="button" onClick={() => { setMode('text'); setError(''); }} className={`relative flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors ${mode === 'text' ? 'text-zinc-800 dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}>
              {mode === 'text' && (
                <motion.span
                  layoutId="video-mode-pill"
                  transition={{ type: 'spring', damping: 28, stiffness: 320 }}
                  className="absolute inset-0 rounded-lg bg-white shadow-sm dark:bg-zinc-800"
                />
              )}
              <span className="relative flex items-center gap-2"><Clapperboard className="h-4 w-4" /> 文字生成</span>
            </button>
            <button type="button" onClick={() => { setMode('image'); setError(''); }} className={`relative flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors ${mode === 'image' ? 'text-zinc-800 dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}>
              {mode === 'image' && (
                <motion.span
                  layoutId="video-mode-pill"
                  transition={{ type: 'spring', damping: 28, stiffness: 320 }}
                  className="absolute inset-0 rounded-lg bg-white shadow-sm dark:bg-zinc-800"
                />
              )}
              <span className="relative flex items-center gap-2"><ImagePlus className="h-4 w-4" /> 图片转视频</span>
            </button>
          </div>

          {mode === 'image' ? (
            <div className="grid gap-4">
              {renderFramePicker({ kind: 'image', label: '参考图片', file: image, previewUrl: imagePreviewUrl, inputKey: imageInputKey })}
            </div>
          ) : null}

          <div className="space-y-2">
            <label htmlFor="video-prompt" className="text-sm font-medium">视频描述</label>
            <textarea id="video-prompt" value={prompt} maxLength={VIDEO_PROMPT_MAX_LENGTH} onChange={(event) => setPrompt(event.target.value)} placeholder="描述你想生成的视频内容" className="min-h-[140px] w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none transition-colors focus:border-primary dark:border-zinc-700 dark:bg-zinc-900" />
            <div className="text-right text-xs text-zinc-500">{prompt.length}/{VIDEO_PROMPT_MAX_LENGTH}</div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <label htmlFor="video-ratio" className="text-sm font-medium">画面比例</label>
              <select id="video-ratio" value={ratio} onChange={(event) => setRatio(event.target.value)} className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm outline-none cursor-pointer transition-colors hover:border-zinc-300 focus:border-primary dark:border-zinc-700 dark:bg-zinc-900">
                {VIDEO_ASPECT_RATIO_OPTIONS.map((option) => (<option key={option.id} value={option.id}>{option.label}</option>))}
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor="video-duration" className="text-sm font-medium">视频时长</label>
              <select id="video-duration" value={duration} onChange={(event) => setDuration(Number(event.target.value))} className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm outline-none cursor-pointer transition-colors hover:border-zinc-300 focus:border-primary dark:border-zinc-700 dark:bg-zinc-900">
                {VIDEO_DURATION_OPTIONS.map((option) => (<option key={option.id} value={option.id}>{option.label}</option>))}
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor="video-resolution" className="text-sm font-medium">分辨率</label>
              <select id="video-resolution" value={resolution} onChange={(event) => setResolution(event.target.value)} className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm outline-none cursor-pointer transition-colors hover:border-zinc-300 focus:border-primary dark:border-zinc-700 dark:bg-zinc-900">
                {VIDEO_RESOLUTION_OPTIONS.map((option) => (<option key={option.id} value={option.id}>{option.label}</option>))}
              </select>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex min-h-[64px] items-center gap-3 rounded-xl border border-zinc-200 px-4 py-3 text-sm dark:border-zinc-700">
              <input type="checkbox" checked={generateAudio} onChange={(event) => setGenerateAudio(event.target.checked)} className="h-4 w-4 accent-primary" />
              生成音轨
            </label>
            <label className="flex min-h-[64px] items-center gap-3 rounded-xl border border-zinc-200 px-4 py-3 text-sm dark:border-zinc-700">
              <input type="checkbox" checked={watermark} onChange={(event) => setWatermark(event.target.checked)} className="h-4 w-4 accent-primary" />
              添加水印
            </label>
          </div>

          <p className="text-xs text-zinc-500">视频任务提交后会进入下方列表，排队中和生成中的任务会自动刷新。</p>

          <button type="submit" disabled={isSubmitting} className="btn-primary flex h-12 w-full items-center justify-center gap-2 rounded-xl font-medium disabled:opacity-60">
            {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
            {isSubmitting ? '正在创建任务…' : '创建视频任务'}
          </button>
        </form>
      </div>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">视频任务</h3>
            <p className="text-sm text-zinc-500">完成后会自动转存并显示播放入口。</p>
          </div>
          <button
            type="button"
            onClick={() => loadTasks()}
            disabled={tasksLoading}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-zinc-200 px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <RefreshCw className={`h-4 w-4 ${tasksLoading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>

        {tasksLoading ? (
          <div className="space-y-3" aria-hidden="true">
            {[0, 1].map((i) => (
              <div key={i} className="rounded-2xl border border-zinc-200/70 bg-white/80 p-4 shadow-sm dark:border-zinc-800/70 dark:bg-zinc-950/70">
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-8 w-20 rounded-full bg-zinc-200 animate-pulse" />
                  <div className="h-4 w-28 rounded bg-zinc-100 animate-pulse" />
                </div>
                <div className="h-4 w-3/4 rounded bg-zinc-100 animate-pulse mb-2" />
                <div className="h-3 w-1/2 rounded bg-zinc-100 animate-pulse" />
              </div>
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-200/70 bg-white/80 p-8 flex flex-col items-center justify-center text-center gap-3 dark:border-zinc-800/70 dark:bg-zinc-950/70">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Clapperboard className="h-6 w-6" />
            </span>
            <p className="text-sm font-medium text-zinc-500">暂无视频任务</p>
            <p className="text-xs text-zinc-400">在上方填写描述并创建任务，生成进度会实时同步到这里</p>
          </div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence initial={false}>
              {tasks.map((task) => (
                <VideoTaskCard
                  key={task.id}
                  task={task}
                  acting={actingTaskId === task.id}
                  stale={staleTaskIds.has(task.id)}
                  onRefresh={refreshTask}
                  onDelete={setDeleteConfirmTask}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </section>

      <ConfirmModal
        open={Boolean(deleteConfirmTask)}
        onClose={() => setDeleteConfirmTask(null)}
        onConfirm={handleDeleteTask}
        title="删除视频任务"
        message="确定要删除这个视频任务吗？已生成的视频将无法再访问。"
        confirmText="删除"
        danger
      />
    </div>
  );
}
