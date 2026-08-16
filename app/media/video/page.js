'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import NextImage from 'next/image';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  CheckCircle2,
  Clapperboard,
  Clock3,
  Download,
  Film,
  Images,
  ImagePlus,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from 'lucide-react';
import ConfirmModal from '@/app/components/modals/ConfirmModal';
import {
  createVideoTask,
  deleteVideoSource,
  deleteVideoTask,
  getVideoTask,
  listVideoTasks,
  uploadVideoSource,
} from '@/lib/media/client/media';
import {
  VIDEO_ASPECT_RATIO_OPTIONS,
  VIDEO_DURATION_OPTIONS,
  VIDEO_EDIT_RESOLUTION_OPTIONS,
  VIDEO_IMAGE_ACCEPTED_MIME_TYPES,
  VIDEO_IMAGE_MAX_BYTES,
  VIDEO_MODELS,
  VIDEO_MODE_OPTIONS,
  VIDEO_MODEL_NAME,
  VIDEO_PROMPT_MAX_LENGTH,
  VIDEO_RESOLUTION_OPTIONS,
  VIDEO_SEED_MAX,
  VIDEO_SOURCE_VIDEO_ACCEPTED_MIME_TYPES,
  VIDEO_SOURCE_VIDEO_MAX_BYTES,
  getVideoPromptWeight,
} from '@/lib/media/shared/models';

const ACTIVE_STATUSES = new Set(['queued', 'in_progress', 'finalizing']);
const DELETABLE_STATUSES = new Set(['completed', 'failed', 'canceled']);
const IMAGE_MAX_MB = Math.round(VIDEO_IMAGE_MAX_BYTES / (1024 * 1024));
const VIDEO_MAX_MB = Math.round(VIDEO_SOURCE_VIDEO_MAX_BYTES / (1024 * 1024));
const STALE_TASK_MS = 10 * 60 * 1000;

const MODE_DETAILS = Object.freeze({
  text: { icon: Clapperboard, title: '文生视频', emptyPrompt: false },
  'first-frame': { icon: ImagePlus, title: '首帧生视频', emptyPrompt: true },
  reference: { icon: Images, title: '多图参考生视频', emptyPrompt: false },
  edit: { icon: WandSparkles, title: '视频编辑', emptyPrompt: false },
});

const STATUS_LABELS = {
  queued: '排队中',
  in_progress: '生成中',
  finalizing: '正在保存',
  completed: '已完成',
  failed: '失败',
  canceled: '已取消',
};

const STATUS_STYLES = {
  queued: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300',
  in_progress: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-300',
  finalizing: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-300',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300',
  failed: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300',
  canceled: 'border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
};

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
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 ? `${duration} 秒` : '';
}

function formatRatio(value) {
  return VIDEO_ASPECT_RATIO_OPTIONS.find((option) => option.id === value)?.label || value || '';
}

function getTaskError(task) {
  if (typeof task?.error?.message === 'string') return task.error.message;
  if (typeof task?.error?.code === 'string') return task.error.code;
  return '';
}

function mergeTask(tasks, nextTask) {
  if (!nextTask?.id) return tasks;
  if (!tasks.some((task) => task.id === nextTask.id)) return [nextTask, ...tasks];
  return tasks.map((task) => (task.id === nextTask.id ? nextTask : task));
}

function fileMatchesMime(file, acceptedMimeTypes, acceptedExtensions) {
  if (acceptedMimeTypes.includes(file.type)) return true;
  const extension = String(file.name || '').split('.').pop()?.toLowerCase();
  return Boolean(extension && acceptedExtensions.includes(extension));
}

function readImageMetadata(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    const finish = () => URL.revokeObjectURL(objectUrl);
    image.onload = () => {
      const metadata = { width: image.naturalWidth, height: image.naturalHeight };
      finish();
      resolve(metadata);
    };
    image.onerror = () => {
      finish();
      reject(new Error(`无法读取图片「${file.name}」`));
    };
    image.src = objectUrl;
  });
}

function sampleVideoFrameRate(video) {
  if (typeof video.requestVideoFrameCallback !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => {
    const samples = [];
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      video.pause();
      resolve(value);
    };
    const timeout = window.setTimeout(() => {
      if (samples.length < 2) return finish(null);
      const first = samples[0];
      const last = samples[samples.length - 1];
      const elapsed = last.mediaTime - first.mediaTime;
      finish(elapsed > 0 ? (last.presentedFrames - first.presentedFrames) / elapsed : null);
    }, 1800);
    const observe = (_now, metadata) => {
      samples.push(metadata);
      if (samples.length >= 2 && metadata.mediaTime - samples[0].mediaTime >= 1) {
        window.clearTimeout(timeout);
        const elapsed = metadata.mediaTime - samples[0].mediaTime;
        finish((metadata.presentedFrames - samples[0].presentedFrames) / elapsed);
        return;
      }
      if (!finished) video.requestVideoFrameCallback(observe);
    };
    video.requestVideoFrameCallback(observe);
    video.play().catch(() => {
      window.clearTimeout(timeout);
      finish(null);
    });
  });
}

function readVideoMetadata(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    const finish = () => {
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(objectUrl);
    };
    video.onloadedmetadata = async () => {
      try {
        const frameRate = await sampleVideoFrameRate(video);
        resolve({
          width: video.videoWidth,
          height: video.videoHeight,
          duration: video.duration,
          frameRate,
        });
      } finally {
        finish();
      }
    };
    video.onerror = () => {
      finish();
      reject(new Error(`无法读取视频「${file.name}」`));
    };
    video.src = objectUrl;
  });
}

function validateImageFileBasics(file) {
  if (!fileMatchesMime(file, VIDEO_IMAGE_ACCEPTED_MIME_TYPES, ['jpg', 'jpeg', 'png', 'webp'])) {
    return '图片仅支持 JPG、PNG 或 WEBP';
  }
  if (file.size <= 0 || file.size > VIDEO_IMAGE_MAX_BYTES) {
    return `每张图片不能超过 ${IMAGE_MAX_MB}MB`;
  }
  return '';
}

async function validateImageMetadata(file, mode) {
  const { width, height } = await readImageMetadata(file);
  const ratio = width / height;
  if (mode === 'reference') {
    if (Math.min(width, height) < 400) return `图片「${file.name}」的短边不能低于 400 像素`;
    return '';
  }
  if (width < 300 || height < 300) return `图片「${file.name}」的宽和高都不能低于 300 像素`;
  if (ratio < 0.4 || ratio > 2.5) return `图片「${file.name}」的宽高比需在 1:2.5 至 2.5:1 之间`;
  return '';
}

async function validateEditVideo(file) {
  if (!fileMatchesMime(file, VIDEO_SOURCE_VIDEO_ACCEPTED_MIME_TYPES, ['mp4', 'mov'])) {
    return '视频编辑仅支持 MP4 或 MOV';
  }
  if (file.size <= 0 || file.size > VIDEO_SOURCE_VIDEO_MAX_BYTES) {
    return `视频不能超过 ${VIDEO_MAX_MB}MB`;
  }
  const metadata = await readVideoMetadata(file);
  const longEdge = Math.max(metadata.width, metadata.height);
  const shortEdge = Math.min(metadata.width, metadata.height);
  const ratio = metadata.width / metadata.height;
  if (metadata.duration < 3 || metadata.duration > 60) return '输入视频时长必须在 3 至 60 秒之间';
  if (longEdge > 4096 || shortEdge < 360) return '输入视频长边不能超过 4096 像素，短边不能低于 360 像素';
  if (ratio < 0.4 || ratio > 2.5) return '输入视频宽高比需在 1:2.5 至 2.5:1 之间';
  if (Number.isFinite(metadata.frameRate) && metadata.frameRate <= 8) return '输入视频帧率必须高于 8fps';
  return '';
}

function PreviewImage({ file, alt }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let objectUrl = "";
    const timer = window.setTimeout(() => {
      objectUrl = URL.createObjectURL(file);
      setSrc(objectUrl);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file]);
  if (!src) return null;
  return <NextImage src={src} alt={alt} fill sizes="180px" unoptimized className="object-cover" />;
}

function PreviewVideo({ file }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let objectUrl = "";
    const timer = window.setTimeout(() => {
      objectUrl = URL.createObjectURL(file);
      setSrc(objectUrl);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file]);
  if (!src) return null;
  return <video src={src} muted controls playsInline className="h-48 w-full bg-black object-contain" />;
}

function StatusBadge({ status }) {
  const Icon = status === 'completed'
    ? CheckCircle2
    : status === 'failed'
      ? AlertTriangle
      : status === 'in_progress' || status === 'finalizing'
        ? Loader2
        : Clock3;
  return (
    <span className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium ${STATUS_STYLES[status] || STATUS_STYLES.queued}`}>
      <Icon className={`h-3.5 w-3.5 ${status === 'in_progress' || status === 'finalizing' ? 'animate-spin' : ''}`} />
      {STATUS_LABELS[status] || status || '排队中'}
    </span>
  );
}

function TaskCard({ task, acting, stale, onRefresh, onDelete }) {
  const params = task.params || {};
  const usage = task.usage || {};
  const mode = MODE_DETAILS[task.mode] || MODE_DETAILS.text;
  const errorText = getTaskError(task);
  const duration = usage.output_video_duration ?? params.duration;
  const resolution = usage.SR ? `${usage.SR}P` : params.resolution;
  const ratio = usage.ratio || params.ratio;
  const inputDuration = Number(usage.input_video_duration);
  const billedDuration = Number(usage.duration);

  return (
    <motion.article
      layout="position"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className="rounded-2xl border border-zinc-200/70 bg-white/80 p-4 shadow-sm dark:border-zinc-800/70 dark:bg-zinc-950/70"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={task.status} />
            <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{mode.title}</span>
            <span className="rounded-full bg-zinc-100 px-2 py-1 text-[11px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">{task.model}</span>
          </div>
          <p className="line-clamp-2 text-sm text-zinc-600 dark:text-zinc-300">{task.prompt || '仅使用首帧图片生成'}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
            {ratio ? <span>{formatRatio(ratio)}</span> : null}
            {duration ? <span>{formatDuration(duration)}</span> : null}
            {resolution ? <span>{resolution}</span> : null}
            {task.mode === 'edit' ? <span>{params.audioSetting === 'origin' ? '保留原声' : '自动处理声音'}</span> : null}
            {Number.isFinite(inputDuration) && inputDuration > 0 ? <span>输入 {inputDuration} 秒</span> : null}
            {Number.isFinite(billedDuration) && billedDuration > 0 ? <span>实际用量 {billedDuration} 秒</span> : null}
            {params.watermark ? <span>带水印</span> : null}
            {Number.isInteger(params.seed) ? <span>种子 {params.seed}</span> : null}
            {formatDate(task.createdAt) ? <span>{formatDate(task.createdAt)}</span> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={() => onRefresh(task.id)} disabled={acting} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800" aria-label="刷新任务" title="刷新任务">
            <RefreshCw className={`h-4 w-4 ${acting ? 'animate-spin' : ''}`} />
          </button>
          {DELETABLE_STATUSES.has(task.status) ? (
            <button type="button" onClick={() => onDelete(task)} disabled={acting} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
              <Trash2 className="h-4 w-4" /> 删除
            </button>
          ) : (
            <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-sm text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" /> 运行中
            </span>
          )}
        </div>
      </div>

      {stale ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">任务耗时较长，可能仍在排队，可手动刷新状态。</div> : null}
      {errorText ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">{errorText}</div> : null}
      {task.videoUrl ? (
        <div className="mt-4 space-y-3">
          <video controls playsInline className="w-full overflow-hidden rounded-xl border border-zinc-200 bg-black dark:border-zinc-700" src={task.videoUrl}>您的浏览器不支持视频播放。</video>
          <a href={`${task.videoUrl}?download=1`} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
            <Download className="h-4 w-4" /> 下载视频
          </a>
        </div>
      ) : null}
    </motion.article>
  );
}

export default function VideoGenerationPage() {
  const [mode, setMode] = useState('text');
  const [prompt, setPrompt] = useState('');
  const [ratio, setRatio] = useState('16:9');
  const [duration, setDuration] = useState(5);
  const [resolution, setResolution] = useState('1080P');
  const [audioSetting, setAudioSetting] = useState('auto');
  const [watermark, setWatermark] = useState(false);
  const [seed, setSeed] = useState('');
  const [images, setImages] = useState([]);
  const [video, setVideo] = useState(null);
  const [pickerKey, setPickerKey] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [actingTaskId, setActingTaskId] = useState('');
  const [error, setError] = useState('');
  const [tasks, setTasks] = useState([]);
  const [deleteConfirmTask, setDeleteConfirmTask] = useState(null);
  const [staleTaskIds, setStaleTaskIds] = useState(() => new Set());
  const refreshingActiveTasksRef = useRef(false);

  const promptWeight = useMemo(() => getVideoPromptWeight(prompt), [prompt]);
  const activeTaskKey = useMemo(() => tasks.filter((task) => ACTIVE_STATUSES.has(task.status)).map((task) => task.id).join('|'), [tasks]);
  const modeDetails = MODE_DETAILS[mode];
  const currentModel = VIDEO_MODELS[mode];
  const imageLimit = mode === 'first-frame' ? 1 : mode === 'reference' ? 9 : mode === 'edit' ? 5 : 0;
  const availableResolutions = mode === 'edit' ? VIDEO_EDIT_RESOLUTION_OPTIONS : VIDEO_RESOLUTION_OPTIONS;

  const loadTasks = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setTasksLoading(true);
    try {
      setTasks(await listVideoTasks());
    } catch (loadError) {
      if (!silent) setError(getErrorMessage(loadError, '读取视频任务失败'));
    } finally {
      if (!silent) setTasksLoading(false);
    }
  }, []);

  const refreshTask = useCallback(async (taskId) => {
    if (!taskId) return;
    setActingTaskId(taskId);
    try {
      const nextTask = await getVideoTask(taskId);
      setTasks((current) => mergeTask(current, nextTask));
    } catch (refreshError) {
      setError(getErrorMessage(refreshError, '刷新任务失败'));
    } finally {
      setActingTaskId('');
    }
  }, []);

  const refreshActiveTasks = useCallback(async () => {
    const ids = activeTaskKey ? activeTaskKey.split('|').filter(Boolean) : [];
    if (!ids.length || refreshingActiveTasksRef.current) return;
    refreshingActiveTasksRef.current = true;
    try {
      const nextTasks = [];
      for (let index = 0; index < ids.length; index += 3) {
        const batch = await Promise.allSettled(ids.slice(index, index + 3).map((id) => getVideoTask(id)));
        nextTasks.push(...batch.filter((result) => result.status === 'fulfilled').map((result) => result.value));
      }
      if (nextTasks.length) setTasks((current) => nextTasks.reduce((all, task) => mergeTask(all, task), current));
    } finally {
      refreshingActiveTasksRef.current = false;
    }
  }, [activeTaskKey]);

  useEffect(() => {
    const timer = setTimeout(() => loadTasks(), 0);
    return () => clearTimeout(timer);
  }, [loadTasks]);

  useEffect(() => {
    if (!activeTaskKey) return undefined;
    const initial = setTimeout(refreshActiveTasks, 0);
    const timer = setInterval(refreshActiveTasks, 15_000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [activeTaskKey, refreshActiveTasks]);

  useEffect(() => {
    const compute = () => {
      const now = Date.now();
      setStaleTaskIds(new Set(tasks.filter((task) => ACTIVE_STATUSES.has(task.status) && task.createdAt && now - new Date(task.createdAt).getTime() > STALE_TASK_MS).map((task) => task.id)));
    };
    compute();
    const timer = setInterval(compute, 60_000);
    return () => clearInterval(timer);
  }, [tasks]);

  const changeMode = (nextMode) => {
    setMode(nextMode);
    setError('');
    setImages([]);
    setVideo(null);
    setPickerKey((current) => current + 1);
    setResolution('1080P');
  };

  const addImages = (files) => {
    setError('');
    const candidates = Array.from(files || []);
    const allowed = Math.max(0, imageLimit - images.length);
    if (candidates.length > allowed) setError(`当前模式最多支持 ${imageLimit} 张图片，超出的文件未添加`);
    const accepted = [];
    for (const file of candidates.slice(0, allowed)) {
      const fileError = validateImageFileBasics(file);
      if (fileError) {
        setError(`${file.name}：${fileError}`);
        continue;
      }
      accepted.push(file);
    }
    if (accepted.length) setImages((current) => [...current, ...accepted].slice(0, imageLimit));
  };

  const selectVideo = (file) => {
    setError('');
    if (!file) return setVideo(null);
    if (!fileMatchesMime(file, VIDEO_SOURCE_VIDEO_ACCEPTED_MIME_TYPES, ['mp4', 'mov'])) {
      setError('视频编辑仅支持 MP4 或 MOV');
      return;
    }
    if (file.size > VIDEO_SOURCE_VIDEO_MAX_BYTES) {
      setError(`视频不能超过 ${VIDEO_MAX_MB}MB`);
      return;
    }
    setVideo(file);
  };

  const validateForm = async () => {
    if (!modeDetails.emptyPrompt && !prompt.trim()) return '请输入视频描述';
    if (promptWeight > VIDEO_PROMPT_MAX_LENGTH) return '视频描述最多支持 2500 个中文字符或 5000 个其他字符';
    if (mode === 'first-frame' && images.length !== 1) return '请上传一张首帧图片';
    if (mode === 'reference' && (images.length < 1 || images.length > 9)) return '请上传 1 至 9 张参考图片';
    if (mode === 'edit' && !video) return '请上传需要编辑的视频';
    if (mode === 'edit' && images.length > 5) return '视频编辑最多支持 5 张参考图片';
    if (seed !== '' && (!/^\d+$/.test(seed) || Number(seed) > VIDEO_SEED_MAX)) return `随机种子必须是 0 至 ${VIDEO_SEED_MAX} 的整数`;
    for (const image of images) {
      const metadataError = await validateImageMetadata(image, mode);
      if (metadataError) return metadataError;
    }
    if (video) return validateEditVideo(video);
    return '';
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSubmitting) return;
    setError('');
    setIsSubmitting(true);
    const uploadedIds = [];
    try {
      const validationError = await validateForm();
      if (validationError) throw new Error(validationError);

      const imageSources = [];
      for (const image of images) {
        const source = await uploadVideoSource(image);
        uploadedIds.push(source.fileId);
        imageSources.push(source);
      }
      let videoSource = null;
      if (video) {
        videoSource = await uploadVideoSource(video);
        uploadedIds.push(videoSource.fileId);
      }

      const input = {
        mode,
        prompt: prompt.trim(),
        imageFileIds: imageSources.map((source) => source.fileId),
        videoFileId: videoSource?.fileId || '',
        resolution,
        watermark,
        ...(seed === '' ? {} : { seed: Number(seed) }),
      };
      if (mode !== 'edit') input.duration = duration;
      if (mode === 'text' || mode === 'reference') input.ratio = ratio;
      if (mode === 'edit') input.audioSetting = audioSetting;

      const task = await createVideoTask(input);
      setTasks((current) => mergeTask(current, task));
      setPrompt('');
      setImages([]);
      setVideo(null);
      setSeed('');
      setPickerKey((current) => current + 1);
    } catch (submitError) {
      await Promise.allSettled(uploadedIds.map((fileId) => deleteVideoSource(fileId)));
      setError(getErrorMessage(submitError, '视频任务创建失败'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteTask = async () => {
    const task = deleteConfirmTask;
    setDeleteConfirmTask(null);
    if (!task) return;
    setActingTaskId(task.id);
    setError('');
    try {
      await deleteVideoTask(task.id);
      setTasks((current) => current.filter((item) => item.id !== task.id));
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, '删除视频任务失败'));
    } finally {
      setActingTaskId('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="glass-effect rounded-2xl border border-zinc-200/60 p-5 dark:border-zinc-800/60">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Film className="h-5 w-5" /></span>
          <div>
            <h2 className="text-lg font-semibold">视频创作</h2>
            <p className="text-sm text-zinc-500">使用 {VIDEO_MODEL_NAME} 生成或编辑视频，结果会保存到你的私有空间。</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <AnimatePresence initial={false}>
            {error ? <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden"><div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">{error}</div></motion.div> : null}
          </AnimatePresence>

          <div className="grid gap-2 rounded-xl border border-zinc-200 bg-zinc-100/70 p-1 sm:grid-cols-2 lg:grid-cols-4 dark:border-zinc-700 dark:bg-zinc-900/70">
            {VIDEO_MODE_OPTIONS.map((option) => {
              const Icon = MODE_DETAILS[option.id].icon;
              const active = mode === option.id;
              return (
                <button key={option.id} type="button" onClick={() => changeMode(option.id)} className={`relative min-h-16 rounded-lg px-3 py-2 text-left transition-colors ${active ? 'text-zinc-900 dark:text-white' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}>
                  {active ? <motion.span layoutId="video-mode-pill" className="absolute inset-0 rounded-lg bg-white shadow-sm dark:bg-zinc-800" /> : null}
                  <span className="relative flex items-center gap-2 text-sm font-semibold"><Icon className="h-4 w-4" /> {option.label}</span>
                  <span className="relative mt-1 block text-[11px] leading-4 text-zinc-500">{option.description}</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200/70 bg-zinc-50 px-4 py-3 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60">
            <span>当前模型：<strong className="font-medium text-zinc-700 dark:text-zinc-200">{currentModel}</strong></span>
            {mode === 'edit' ? <span>超过 15 秒的视频只编辑前 15 秒</span> : null}
          </div>

          {mode === 'edit' ? (
            <div className="space-y-2">
              <label htmlFor="video-source" className="text-sm font-medium">原视频</label>
              <div className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900">
                {video ? (
                  <div className="relative">
                    <PreviewVideo file={video} />
                    <button type="button" onClick={() => { setVideo(null); setPickerKey((current) => current + 1); }} className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white" aria-label="移除原视频"><X className="h-4 w-4" /></button>
                    <div className="truncate px-3 py-2 text-xs text-zinc-500">{video.name}</div>
                  </div>
                ) : (
                  <label htmlFor="video-source" className="flex min-h-36 cursor-pointer flex-col items-center justify-center px-4 py-6 text-center text-sm text-zinc-500">
                    <Upload className="mb-2 h-6 w-6" /><span className="font-medium">上传 MP4 或 MOV</span><span className="mt-1 text-xs">3–60 秒，最大 {VIDEO_MAX_MB}MB</span>
                  </label>
                )}
                <input key={`video-${pickerKey}`} id="video-source" type="file" accept="video/mp4,video/quicktime,.mp4,.mov" className="sr-only" onChange={(event) => { selectVideo(event.target.files?.[0] || null); event.target.value = ''; }} />
              </div>
            </div>
          ) : null}

          {imageLimit > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="video-images" className="text-sm font-medium">{mode === 'first-frame' ? '首帧图片' : '参考图片'}</label>
                <span className="text-xs text-zinc-500">{images.length}/{imageLimit}</span>
              </div>
              {images.length ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {images.map((file, index) => (
                    <div key={`${file.name}-${file.lastModified}-${index}`} className="relative overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900">
                      <div className="relative h-36"><PreviewImage file={file} alt={`参考图片 ${index + 1}`} /></div>
                      <div className="flex items-center gap-2 px-3 py-2 text-xs"><span className="shrink-0 font-semibold text-primary">[Image {index + 1}]</span><span className="truncate text-zinc-500">{file.name}</span></div>
                      <button type="button" onClick={() => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white" aria-label={`移除图片 ${index + 1}`}><X className="h-4 w-4" /></button>
                    </div>
                  ))}
                  {images.length < imageLimit ? <label htmlFor="video-images" className="flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 text-sm text-zinc-500 hover:border-primary dark:border-zinc-700"><ImagePlus className="mb-2 h-6 w-6" />继续添加</label> : null}
                </div>
              ) : (
                <label htmlFor="video-images" className="flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-6 text-center text-sm text-zinc-500 hover:border-primary dark:border-zinc-700 dark:bg-zinc-900">
                  <ImagePlus className="mb-2 h-6 w-6" /><span className="font-medium">上传 JPG、PNG 或 WEBP</span><span className="mt-1 text-xs">单张最大 {IMAGE_MAX_MB}MB</span>
                </label>
              )}
              <input key={`images-${pickerKey}`} id="video-images" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple={imageLimit > 1} className="sr-only" onChange={(event) => { addImages(event.target.files); event.target.value = ''; }} />
              {mode === 'reference' && images.length ? <p className="text-xs text-zinc-500">提示词中可使用 [Image 1]、[Image 2] 指代对应顺序的主体。</p> : null}
            </div>
          ) : null}

          <div className="space-y-2">
            <label htmlFor="video-prompt" className="text-sm font-medium">{mode === 'edit' ? '编辑指令' : '视频描述'}{mode === 'first-frame' ? <span className="ml-1 font-normal text-zinc-400">（可选）</span> : null}</label>
            <textarea id="video-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={mode === 'edit' ? '描述需要替换、修改或转换的内容' : mode === 'reference' ? '例如：[Image 1] 中的角色走进 [Image 2] 的场景' : '描述画面、主体、动作、镜头和氛围'} className="min-h-36 w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none transition-colors focus:border-primary dark:border-zinc-700 dark:bg-zinc-900" />
            <div className={`text-right text-xs ${promptWeight > VIDEO_PROMPT_MAX_LENGTH ? 'text-red-500' : 'text-zinc-500'}`}>已用 {promptWeight}/{VIDEO_PROMPT_MAX_LENGTH} 字符额度（中文按 2 计）</div>
          </div>

          <div className={`grid gap-4 ${mode === 'first-frame' ? 'md:grid-cols-2' : mode === 'edit' ? 'md:grid-cols-2' : 'md:grid-cols-3'}`}>
            {(mode === 'text' || mode === 'reference') ? <div className="space-y-2"><label htmlFor="video-ratio" className="text-sm font-medium">画面比例</label><select id="video-ratio" value={ratio} onChange={(event) => setRatio(event.target.value)} className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm outline-none focus:border-primary dark:border-zinc-700 dark:bg-zinc-900">{VIDEO_ASPECT_RATIO_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></div> : null}
            {mode !== 'edit' ? <div className="space-y-2"><label htmlFor="video-duration" className="text-sm font-medium">视频时长</label><select id="video-duration" value={duration} onChange={(event) => setDuration(Number(event.target.value))} className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm outline-none focus:border-primary dark:border-zinc-700 dark:bg-zinc-900">{VIDEO_DURATION_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></div> : null}
            <div className="space-y-2"><label htmlFor="video-resolution" className="text-sm font-medium">分辨率</label><select id="video-resolution" value={resolution} onChange={(event) => setResolution(event.target.value)} className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm outline-none focus:border-primary dark:border-zinc-700 dark:bg-zinc-900">{availableResolutions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></div>
            {mode === 'edit' ? <div className="space-y-2"><label htmlFor="video-audio-setting" className="text-sm font-medium">声音处理</label><select id="video-audio-setting" value={audioSetting} onChange={(event) => setAudioSetting(event.target.value)} className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm outline-none focus:border-primary dark:border-zinc-700 dark:bg-zinc-900"><option value="auto">模型自动处理声音</option><option value="origin">保留原视频声音</option></select></div> : null}
          </div>

          <details className="rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-700">
            <summary className="cursor-pointer text-sm font-medium text-zinc-700 dark:text-zinc-200">高级设置</summary>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="space-y-2"><label htmlFor="video-seed" className="text-sm font-medium">随机种子 <span className="font-normal text-zinc-400">（可选）</span></label><input id="video-seed" inputMode="numeric" value={seed} onChange={(event) => setSeed(event.target.value.replace(/\D/g, ''))} placeholder="留空则随机" className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm outline-none focus:border-primary dark:border-zinc-700 dark:bg-zinc-900" /></div>
              <label className="flex min-h-11 items-center gap-3 self-end rounded-xl border border-zinc-200 px-4 py-3 text-sm dark:border-zinc-700"><input type="checkbox" checked={watermark} onChange={(event) => setWatermark(event.target.checked)} className="h-4 w-4 accent-primary" /><span>添加 Happy Horse 水印</span></label>
            </div>
          </details>

          <p className="text-xs text-zinc-500">提交后会在下方自动同步任务状态。排队中和生成中的任务不能删除。</p>
          <button type="submit" disabled={isSubmitting} className="btn-primary flex h-12 w-full items-center justify-center gap-2 rounded-xl font-medium disabled:opacity-60">
            {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
            {isSubmitting ? '正在检查并上传素材…' : '创建视频任务'}
          </button>
        </form>
      </div>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3"><div><h3 className="text-base font-semibold">视频任务</h3><p className="text-sm text-zinc-500">完成后会自动转存到私有空间并提供播放和下载。</p></div><button type="button" onClick={() => loadTasks()} disabled={tasksLoading} className="inline-flex h-10 items-center gap-2 rounded-xl border border-zinc-200 px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"><RefreshCw className={`h-4 w-4 ${tasksLoading ? 'animate-spin' : ''}`} />刷新</button></div>
        {tasksLoading ? (
          <div className="space-y-3" aria-hidden="true">{[0, 1].map((item) => <div key={item} className="h-32 animate-pulse rounded-2xl border border-zinc-200/70 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900" />)}</div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-zinc-200/70 bg-white/80 p-8 text-center dark:border-zinc-800/70 dark:bg-zinc-950/70"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Clapperboard className="h-6 w-6" /></span><p className="text-sm font-medium text-zinc-500">暂无视频任务</p><p className="text-xs text-zinc-400">在上方选择创作方式并提交，任务会显示在这里</p></div>
        ) : (
          <div className="space-y-3"><AnimatePresence initial={false}>{tasks.map((task) => <TaskCard key={task.id} task={task} acting={actingTaskId === task.id} stale={staleTaskIds.has(task.id)} onRefresh={refreshTask} onDelete={setDeleteConfirmTask} />)}</AnimatePresence></div>
        )}
      </section>

      <ConfirmModal open={Boolean(deleteConfirmTask)} onClose={() => setDeleteConfirmTask(null)} onConfirm={handleDeleteTask} title="删除视频任务" message="确定要删除这个视频任务吗？已生成的视频将无法再访问。" confirmText="删除" danger />
    </div>
  );
}
