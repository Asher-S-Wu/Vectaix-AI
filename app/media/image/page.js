'use client';

import { useEffect, useState } from 'react';
import NextImage from 'next/image';
import { AnimatePresence, motion } from 'framer-motion';
import { ImagePlus, Loader2, RefreshCw, Sparkles, Upload, Wand2, X } from 'lucide-react';
import ImageResultCard from '@/app/components/media/image-result-card';
import { editImage, generateImage } from '@/lib/media/client/media';
import {
  IMAGE_EDIT_ACCEPTED_MIME_TYPES,
  IMAGE_EDIT_MAX_BYTES,
  IMAGE_MODEL_NAME,
  IMAGE_PROMPT_MAX_LENGTH,
  IMAGE_SIZE_OPTIONS,
} from '@/lib/media/shared/models';

const IMAGE_EDIT_MAX_MB = Math.round(IMAGE_EDIT_MAX_BYTES / (1024 * 1024));

export default function ImageGenerationPage() {
  const [mode, setMode] = useState('generate');
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('1024x1024');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [resultTitle, setResultTitle] = useState('生成的图片');
  const [sourceImage, setSourceImage] = useState(null);
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState('');
  const [sourceInputKey, setSourceInputKey] = useState(0);

  useEffect(() => () => {
    if (sourcePreviewUrl) URL.revokeObjectURL(sourcePreviewUrl);
  }, [sourcePreviewUrl]);

  const handleModeChange = (nextMode) => {
    setMode(nextMode);
    setError('');
    setImageUrl('');
    setResultTitle(nextMode === 'edit' ? '编辑后的图片' : '生成的图片');
  };

  const handleSourceImageChange = (file) => {
    setError('');
    setSourceImage(file);
    setSourcePreviewUrl(file ? URL.createObjectURL(file) : '');
    if (!file) setSourceInputKey((current) => current + 1);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (!prompt.trim()) {
      setError('请输入图片描述');
      return;
    }

    if (prompt.trim().length > IMAGE_PROMPT_MAX_LENGTH) {
      setError(`描述最多支持 ${IMAGE_PROMPT_MAX_LENGTH} 个字符`);
      return;
    }

    if (mode === 'edit') {
      if (!sourceImage) {
        setError('请上传需要编辑的图片');
        return;
      }
      if (!IMAGE_EDIT_ACCEPTED_MIME_TYPES.includes(sourceImage.type)) {
        setError('仅支持 PNG、JPG、WEBP 图片');
        return;
      }
      if (sourceImage.size > IMAGE_EDIT_MAX_BYTES) {
        setError(`图片大小不能超过 ${IMAGE_EDIT_MAX_MB}MB`);
        return;
      }
    }

    setIsGenerating(true);
    try {
      const url = mode === 'edit' && sourceImage
        ? await editImage({ prompt: prompt.trim(), size, image: sourceImage })
        : await generateImage({ prompt: prompt.trim(), size });
      setImageUrl(url);
      setResultTitle(mode === 'edit' ? '编辑后的图片' : '生成的图片');
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : '图片处理失败，请稍后再试');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="glass-effect rounded-2xl border border-zinc-200/60 dark:border-zinc-800/60 p-5">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Wand2 className="h-5 w-5" /></span>
          <div>
            <h2 className="text-lg font-semibold">图片生成</h2>
            <p className="text-sm text-zinc-500">使用 {IMAGE_MODEL_NAME}，生成新图片或编辑已有图片。</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <AnimatePresence initial={false}>
            {error ? (
              <motion.div
                key="form-error"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                  <span>{error}</span>
                  <button type="submit" className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline">
                    <RefreshCw className="h-3 w-3" /> 重试
                  </button>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <div className="relative grid grid-cols-2 gap-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-100/70 dark:bg-zinc-900/70 p-1">
            <button type="button" onClick={() => handleModeChange('generate')} className={`relative flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors ${mode === 'generate' ? 'text-zinc-800 dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}>
              {mode === 'generate' && (
                <motion.span
                  layoutId="image-mode-pill"
                  transition={{ type: 'spring', damping: 28, stiffness: 320 }}
                  className="absolute inset-0 rounded-lg bg-white dark:bg-zinc-800 shadow-sm"
                />
              )}
              <span className="relative flex items-center gap-2"><Sparkles className="h-4 w-4" /> 生成图片</span>
            </button>
            <button type="button" onClick={() => handleModeChange('edit')} className={`relative flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors ${mode === 'edit' ? 'text-zinc-800 dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}>
              {mode === 'edit' && (
                <motion.span
                  layoutId="image-mode-pill"
                  transition={{ type: 'spring', damping: 28, stiffness: 320 }}
                  className="absolute inset-0 rounded-lg bg-white dark:bg-zinc-800 shadow-sm"
                />
              )}
              <span className="relative flex items-center gap-2"><ImagePlus className="h-4 w-4" /> 编辑图片</span>
            </button>
          </div>

          {mode === 'edit' ? (
            <div className="space-y-2">
              <label htmlFor="source-image" className="text-sm font-medium">参考图片</label>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
                <label htmlFor="source-image" className="flex min-h-[132px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 px-4 py-5 text-center text-sm text-zinc-500">
                  <Upload className="mb-2 h-6 w-6" />
                  <span className="font-medium">{sourceImage ? sourceImage.name : '上传 PNG、JPG 或 WEBP'}</span>
                  <span className="mt-1 text-xs">最大 {IMAGE_EDIT_MAX_MB}MB</span>
                  <input key={sourceInputKey} id="source-image" type="file" accept={IMAGE_EDIT_ACCEPTED_MIME_TYPES.join(',')} className="sr-only" onChange={(event) => handleSourceImageChange(event.target.files?.[0] || null)} />
                </label>
                <div className="relative overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900">
                  {sourcePreviewUrl ? (
                    <>
                      <NextImage src={sourcePreviewUrl} alt="参考图片" width={512} height={132} unoptimized className="h-[132px] w-full object-contain" />
                      <button type="button" onClick={() => handleSourceImageChange(null)} className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white" aria-label="移除图片">
                        <X className="h-4 w-4" />
                      </button>
                    </>
                  ) : (
                    <div className="flex h-[132px] items-center justify-center text-sm text-zinc-500">未选择图片</div>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <label htmlFor="image-prompt" className="text-sm font-medium">图片描述</label>
            <textarea id="image-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={IMAGE_PROMPT_MAX_LENGTH} placeholder={mode === 'edit' ? '描述你想修改的地方' : '描述你想生成的画面'} className="min-h-[140px] w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-sm outline-none focus:border-primary" />
            <div className="text-right text-xs text-zinc-500">{prompt.length}/{IMAGE_PROMPT_MAX_LENGTH}</div>
          </div>

          <div className="space-y-2">
            <label htmlFor="image-size" className="text-sm font-medium">图片尺寸</label>
            <select id="image-size" value={size} onChange={(event) => setSize(event.target.value)} className="h-11 w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 text-sm outline-none cursor-pointer transition-colors hover:border-zinc-300 focus:border-primary">
              {IMAGE_SIZE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </div>

          <button type="submit" disabled={isGenerating} className="btn-primary flex h-12 w-full items-center justify-center gap-2 rounded-xl font-medium disabled:opacity-60">
            {isGenerating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
            {isGenerating ? '处理中…' : (mode === 'edit' ? '编辑图片' : '生成图片')}
          </button>
        </form>
      </div>

      {isGenerating ? (
        <motion.div
          key="generating"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="glass-effect rounded-2xl border border-zinc-200/60 dark:border-zinc-800/60 p-5 space-y-4"
          aria-live="polite"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            正在生成图片，请稍候…
          </div>
          <div className="relative flex h-[320px] items-center justify-center overflow-hidden rounded-xl border border-primary/20 bg-primary/5">
            <div aria-hidden className="absolute inset-0 animate-pulse bg-gradient-to-br from-primary/10 via-transparent to-primary/10" />
            <div className="relative flex flex-col items-center gap-3 text-primary/70">
              <ImagePlus className="h-10 w-10 animate-pulse" />
              <span className="text-xs">图片生成通常需要十几秒</span>
            </div>
          </div>
        </motion.div>
      ) : imageUrl ? (
        <ImageResultCard imageUrl={imageUrl} title={resultTitle} />
      ) : (
        <div className="glass-effect rounded-2xl border border-dashed border-zinc-200/60 dark:border-zinc-800/60 p-8 flex flex-col items-center justify-center text-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ImagePlus className="h-6 w-6" />
          </span>
          <p className="text-sm font-medium text-zinc-500">生成的图片会显示在这里</p>
          <p className="text-xs text-zinc-400">在上方输入描述，点击「生成图片」开始创作</p>
        </div>
      )}
    </div>
  );
}
