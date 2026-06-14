'use client';

import { useEffect, useState } from 'react';
import { Clapperboard, ImagePlus, Sparkles, Upload, X } from 'lucide-react';
import VideoResultCard from '@/app/components/media/video-result-card';
import { generateVideo } from '@/lib/media/client/media';
import {
  VIDEO_ASPECT_RATIO_OPTIONS,
  VIDEO_DURATION_OPTIONS,
  VIDEO_FRAME_ACCEPTED_MIME_TYPES,
  VIDEO_FRAME_MAX_BYTES,
  VIDEO_ICON_URL,
  VIDEO_MODEL_NAME,
  VIDEO_PERSON_GENERATION_OPTIONS,
  VIDEO_PROMPT_MAX_LENGTH,
  VIDEO_RESOLUTION_OPTIONS,
} from '@/lib/media/shared/models';

function isAcceptedFrame(file) {
  return VIDEO_FRAME_ACCEPTED_MIME_TYPES.includes(file.type);
}

export default function VideoGenerationPage() {
  const [mode, setMode] = useState('text');
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [durationSeconds, setDurationSeconds] = useState(5);
  const [resolution, setResolution] = useState('720p');
  const [generateAudio, setGenerateAudio] = useState(true);
  const [enhancePrompt, setEnhancePrompt] = useState(false);
  const [personGeneration, setPersonGeneration] = useState('');
  const [seed, setSeed] = useState('');
  const [fps, setFps] = useState('');
  const [image, setImage] = useState(null);
  const [lastFrame, setLastFrame] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState('');
  const [lastFramePreviewUrl, setLastFramePreviewUrl] = useState('');
  const [imageInputKey, setImageInputKey] = useState(0);
  const [lastFrameInputKey, setLastFrameInputKey] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const [videoUrl, setVideoUrl] = useState('');

  useEffect(() => {
    if (!image) { setImagePreviewUrl(''); return undefined; }
    const nextUrl = URL.createObjectURL(image);
    setImagePreviewUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [image]);

  useEffect(() => {
    if (!lastFrame) { setLastFramePreviewUrl(''); return undefined; }
    const nextUrl = URL.createObjectURL(lastFrame);
    setLastFramePreviewUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [lastFrame]);

  const handleFrameChange = (kind, file) => {
    setError('');
    if (kind === 'image') {
      setImage(file);
      if (!file) setImageInputKey((current) => current + 1);
      return;
    }
    setLastFrame(file);
    if (!file) setLastFrameInputKey((current) => current + 1);
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
      <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900">
        <div className="relative min-h-[130px]">
          <label htmlFor={`video-${kind}`} className="flex min-h-[130px] cursor-pointer flex-col items-center justify-center px-4 py-5 text-center text-sm text-zinc-500">
            {previewUrl ? <img src={previewUrl} alt={label} className="h-[156px] w-full object-contain" /> : (
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
    setVideoUrl('');

    if (mode === 'text' && !prompt.trim()) {
      setError('请输入视频描述');
      return;
    }
    if (mode === 'image' && !image) {
      setError('请上传首帧图片');
      return;
    }
    if (prompt.trim().length > VIDEO_PROMPT_MAX_LENGTH) {
      setError(`视频描述最多支持 ${VIDEO_PROMPT_MAX_LENGTH} 个字符`);
      return;
    }
    if (negativePrompt.trim().length > VIDEO_PROMPT_MAX_LENGTH) {
      setError(`不希望出现的内容最多支持 ${VIDEO_PROMPT_MAX_LENGTH} 个字符`);
      return;
    }

    const imageError = validateFrame(mode === 'image' ? image : null, '首帧图片');
    if (imageError) { setError(imageError); return; }
    const lastFrameError = validateFrame(mode === 'image' ? lastFrame : null, '尾帧图片');
    if (lastFrameError) { setError(lastFrameError); return; }
    if (seed.trim() && !Number.isFinite(Number(seed.trim()))) {
      setError('种子必须是数字');
      return;
    }
    const fpsNumber = Number(fps.trim());
    if (fps.trim() && (!Number.isInteger(fpsNumber) || fpsNumber <= 0)) {
      setError('帧率必须是正整数');
      return;
    }

    setIsGenerating(true);
    try {
      const url = await generateVideo({
        prompt: prompt.trim(),
        aspectRatio,
        durationSeconds,
        resolution,
        image: mode === 'image' ? image : null,
        lastFrame: mode === 'image' ? lastFrame : null,
        negativePrompt: negativePrompt.trim(),
        generateAudio,
        enhancePrompt,
        personGeneration,
        seed: seed.trim(),
        fps: fps.trim(),
      });
      setVideoUrl(url);
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : '视频生成失败，请稍后再试');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="glass-effect rounded-2xl border border-zinc-200/60 dark:border-zinc-800/60 p-5">
        <div className="mb-5 flex items-center gap-3">
          <img src={VIDEO_ICON_URL} alt="" className="h-10 w-10 object-contain" />
          <div>
            <h2 className="text-lg font-semibold">视频生成</h2>
            <p className="text-sm text-zinc-500">使用 {VIDEO_MODEL_NAME}，生成短视频或让图片动起来。</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div> : null}

          <div className="grid grid-cols-2 gap-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-100/70 dark:bg-zinc-900/70 p-1">
            <button type="button" onClick={() => { setMode('text'); setError(''); setVideoUrl(''); }} className={`flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-semibold ${mode === 'text' ? 'bg-white dark:bg-zinc-800 shadow-sm' : 'text-zinc-500'}`}>
              <Clapperboard className="h-4 w-4" /> 文字生成
            </button>
            <button type="button" onClick={() => { setMode('image'); setError(''); setVideoUrl(''); }} className={`flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-semibold ${mode === 'image' ? 'bg-white dark:bg-zinc-800 shadow-sm' : 'text-zinc-500'}`}>
              <ImagePlus className="h-4 w-4" /> 图片转视频
            </button>
          </div>

          {mode === 'image' ? (
            <div className="grid gap-4 md:grid-cols-2">
              {renderFramePicker({ kind: 'image', label: '首帧图片', file: image, previewUrl: imagePreviewUrl, inputKey: imageInputKey })}
              {renderFramePicker({ kind: 'lastFrame', label: '尾帧图片', file: lastFrame, previewUrl: lastFramePreviewUrl, inputKey: lastFrameInputKey })}
            </div>
          ) : null}

          <div className="space-y-2">
            <label htmlFor="video-prompt" className="text-sm font-medium">视频描述</label>
            <textarea id="video-prompt" value={prompt} maxLength={VIDEO_PROMPT_MAX_LENGTH} onChange={(event) => setPrompt(event.target.value)} placeholder="描述你想生成的视频内容" className="min-h-[140px] w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-sm outline-none" />
            <div className="text-right text-xs text-zinc-500">{prompt.length}/{VIDEO_PROMPT_MAX_LENGTH}</div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <label htmlFor="video-aspect" className="text-sm font-medium">画面比例</label>
              <select id="video-aspect" value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)} className="h-11 w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 text-sm">
                {VIDEO_ASPECT_RATIO_OPTIONS.map((option) => (<option key={option.id} value={option.id}>{option.label}</option>))}
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor="video-duration" className="text-sm font-medium">视频时长</label>
              <select id="video-duration" value={durationSeconds} onChange={(event) => setDurationSeconds(Number(event.target.value))} className="h-11 w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 text-sm">
                {VIDEO_DURATION_OPTIONS.map((option) => (<option key={option.id} value={option.id}>{option.label}</option>))}
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor="video-resolution" className="text-sm font-medium">分辨率</label>
              <select id="video-resolution" value={resolution} onChange={(event) => setResolution(event.target.value)} className="h-11 w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 text-sm">
                {VIDEO_RESOLUTION_OPTIONS.map((option) => (<option key={option.id} value={option.id}>{option.label}</option>))}
              </select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="video-negative" className="text-sm font-medium">不希望出现的内容</label>
              <textarea id="video-negative" value={negativePrompt} maxLength={VIDEO_PROMPT_MAX_LENGTH} onChange={(event) => setNegativePrompt(event.target.value)} placeholder="例如：低清晰度、画面抖动" className="min-h-[96px] w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-sm outline-none" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex min-h-[72px] items-center gap-3 rounded-xl border border-zinc-200 dark:border-zinc-700 px-4 py-3 text-sm">
                <input type="checkbox" checked={generateAudio} onChange={(event) => setGenerateAudio(event.target.checked)} className="h-4 w-4" />
                生成音轨
              </label>
              <label className="flex min-h-[72px] items-center gap-3 rounded-xl border border-zinc-200 dark:border-zinc-700 px-4 py-3 text-sm">
                <input type="checkbox" checked={enhancePrompt} onChange={(event) => setEnhancePrompt(event.target.checked)} className="h-4 w-4" />
                自动优化描述
              </label>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <label htmlFor="video-person" className="text-sm font-medium">人物生成</label>
              <select id="video-person" value={personGeneration} onChange={(event) => setPersonGeneration(event.target.value)} className="h-11 w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 text-sm">
                {VIDEO_PERSON_GENERATION_OPTIONS.map((option) => (<option key={option.id || 'default'} value={option.id}>{option.label}</option>))}
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor="video-seed" className="text-sm font-medium">种子</label>
              <input id="video-seed" value={seed} onChange={(event) => setSeed(event.target.value)} inputMode="numeric" placeholder="留空随机" className="h-11 w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 text-sm outline-none" />
            </div>
            <div className="space-y-2">
              <label htmlFor="video-fps" className="text-sm font-medium">帧率</label>
              <input id="video-fps" value={fps} onChange={(event) => setFps(event.target.value)} inputMode="numeric" placeholder="默认" className="h-11 w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 text-sm outline-none" />
            </div>
          </div>

          <p className="text-xs text-zinc-500">视频生成通常需要 1 到 3 分钟，请耐心等待。</p>

          <button type="submit" disabled={isGenerating} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900">
            <Sparkles className="h-5 w-5" />
            {isGenerating ? '生成中，请稍候...' : '生成视频'}
          </button>
        </form>
      </div>

      <VideoResultCard videoUrl={videoUrl} />
    </div>
  );
}
