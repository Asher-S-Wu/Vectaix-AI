'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import NextImage from 'next/image';
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

const STATUS_LABELS = {
  queued: '排队中',
  in_progress: '生成中',
  completed: '已完成',
  failed: '失败',
};

const STATUS_STYLES = {
  queued: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300',
  in_progress: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300',
  failed: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300',
};

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
  return `${total.toLocaleString('zh-CN')} tokens`;
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
  const Icon = status === 'completed' ? CheckCircle2 : status === 'failed' ? AlertTriangle : Clock3;
  return (
    <span className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium ${style}`}>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

function VideoTaskCard({ task, acting, onRefresh, onDelete }) {
  const params = task.params || {};
  const createdAt = formatDate(task.createdAt);
  const tokens = formatTokens(task);
  const errorText = getTaskError(task);
  const canDelete = DELETABLE_STATUSES.has(task.status);
  const isActive = ACTIVE_STATUSES.has(task.status);
  const title = task.inputMode === 'image' ? '参考图生成视频' : '文字生成视频';

  return (
    <article className="rounded-2xl border border-zinc-200/70 bg-white/80 p-4 shadow-sm dark:border-zinc-800/70 dark:bg-zinc-950/70">
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
            <span>{params.ratio || 'adaptive'}</span>
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
            <RefreshCw className={`h-4 w-4 ${isActive ? 'animate-spin' : ''}`} />
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
            className="w-full overflow-hidden rounded-xl border border-zinc-200 bg-black dark:border-zinc-700"
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
    </article>
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

  const handleFrameChange = (_kind, file) => {
    setError('');
    setImage(file);
    setImagePreviewUrl(file ? URL.createObjectURL(file) : '');
    if (!file) setImageInputKey((current) => current + 1);
  };

  const validateFrame = (file, label) => {
    if (!file) return '';
    if (!isAcceptedFrame(file)) return `${label}仅支持 PNG、JPG、WEBP 图片`;
    if (file.size > VIDEO_FRAME_MAX_BYTES) return `${label}大小不能超过 25MB`;
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
                <span className="mt-1 text-xs">最大 25MB</span>
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

  const handleDeleteTask = async (task) => {
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
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300"><Clapperboard className="h-5 w-5" /></span>
          <div>
            <h2 className="text-lg font-semibold">视频生成</h2>
            <p className="text-sm text-zinc-500">使用 {VIDEO_MODEL_NAME}，创建视频任务并自动同步结果。</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div> : null}

          <div className="grid grid-cols-2 gap-2 rounded-xl border border-zinc-200 bg-zinc-100/70 p-1 dark:border-zinc-700 dark:bg-zinc-900/70">
            <button type="button" onClick={() => { setMode('text'); setError(''); }} className={`flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-semibold ${mode === 'text' ? 'bg-white shadow-sm dark:bg-zinc-800' : 'text-zinc-500'}`}>
              <Clapperboard className="h-4 w-4" /> 文字生成
            </button>
            <button type="button" onClick={() => { setMode('image'); setError(''); }} className={`flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-semibold ${mode === 'image' ? 'bg-white shadow-sm dark:bg-zinc-800' : 'text-zinc-500'}`}>
              <ImagePlus className="h-4 w-4" /> 图片转视频
            </button>
          </div>

          {mode === 'image' ? (
            <div className="grid gap-4">
              {renderFramePicker({ kind: 'image', label: '参考图片', file: image, previewUrl: imagePreviewUrl, inputKey: imageInputKey })}
            </div>
          ) : null}

          <div className="space-y-2">
            <label htmlFor="video-prompt" className="text-sm font-medium">视频描述</label>
            <textarea id="video-prompt" value={prompt} maxLength={VIDEO_PROMPT_MAX_LENGTH} onChange={(event) => setPrompt(event.target.value)} placeholder="描述你想生成的视频内容" className="min-h-[140px] w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none dark:border-zinc-700 dark:bg-zinc-900" />
            <div className="text-right text-xs text-zinc-500">{prompt.length}/{VIDEO_PROMPT_MAX_LENGTH}</div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <label htmlFor="video-ratio" className="text-sm font-medium">画面比例</label>
              <select id="video-ratio" value={ratio} onChange={(event) => setRatio(event.target.value)} className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm dark:border-zinc-700 dark:bg-zinc-900">
                {VIDEO_ASPECT_RATIO_OPTIONS.map((option) => (<option key={option.id} value={option.id}>{option.label}</option>))}
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor="video-duration" className="text-sm font-medium">视频时长</label>
              <select id="video-duration" value={duration} onChange={(event) => setDuration(Number(event.target.value))} className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm dark:border-zinc-700 dark:bg-zinc-900">
                {VIDEO_DURATION_OPTIONS.map((option) => (<option key={option.id} value={option.id}>{option.label}</option>))}
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor="video-resolution" className="text-sm font-medium">分辨率</label>
              <select id="video-resolution" value={resolution} onChange={(event) => setResolution(event.target.value)} className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm dark:border-zinc-700 dark:bg-zinc-900">
                {VIDEO_RESOLUTION_OPTIONS.map((option) => (<option key={option.id} value={option.id}>{option.label}</option>))}
              </select>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex min-h-[64px] items-center gap-3 rounded-xl border border-zinc-200 px-4 py-3 text-sm dark:border-zinc-700">
              <input type="checkbox" checked={generateAudio} onChange={(event) => setGenerateAudio(event.target.checked)} className="h-4 w-4" />
              生成音轨
            </label>
            <label className="flex min-h-[64px] items-center gap-3 rounded-xl border border-zinc-200 px-4 py-3 text-sm dark:border-zinc-700">
              <input type="checkbox" checked={watermark} onChange={(event) => setWatermark(event.target.checked)} className="h-4 w-4" />
              添加水印
            </label>
          </div>

          <p className="text-xs text-zinc-500">视频任务提交后会进入下方列表，排队中和生成中的任务会自动刷新。</p>

          <button type="submit" disabled={isSubmitting} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900">
            {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
            {isSubmitting ? '正在创建任务...' : '创建视频任务'}
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
          <div className="rounded-2xl border border-zinc-200/70 bg-white/80 p-6 text-sm text-zinc-500 dark:border-zinc-800/70 dark:bg-zinc-950/70">
            正在读取任务...
          </div>
        ) : tasks.length === 0 ? (
          <div className="rounded-2xl border border-zinc-200/70 bg-white/80 p-6 text-sm text-zinc-500 dark:border-zinc-800/70 dark:bg-zinc-950/70">
            暂无视频任务
          </div>
        ) : (
          <div className="space-y-3">
            {tasks.map((task) => (
              <VideoTaskCard
                key={task.id}
                task={task}
                acting={actingTaskId === task.id}
                onRefresh={refreshTask}
                onDelete={handleDeleteTask}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
