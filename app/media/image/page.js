'use client';

import { useEffect, useRef, useState } from 'react';
import NextImage from 'next/image';
import { AnimatePresence, motion } from 'framer-motion';
import { ImagePlus, Loader2, RefreshCw, Sparkles, Upload, Wand2, X } from 'lucide-react';
import ImageResultCard from '@/app/components/media/image-result-card';
import { editImage, generateImage } from '@/lib/media/client/media';
import {
  IMAGE_EDIT_ACCEPTED_MIME_TYPES,
  IMAGE_EDIT_ACCEPTED_EXTENSIONS,
  IMAGE_EDIT_MAX_BYTES,
  IMAGE_EDIT_MAX_COUNT,
  IMAGE_MODEL_NAME,
  IMAGE_PROMPT_MAX_LENGTH,
  IMAGE_SIZE_OPTIONS,
} from '@/lib/media/shared/models';
import { useCredits } from '@/lib/client/credits/CreditContext';

const IMAGE_EDIT_MAX_MB = Math.round(IMAGE_EDIT_MAX_BYTES / (1024 * 1024));

function getSourceImageError(file) {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  if (
    !IMAGE_EDIT_ACCEPTED_MIME_TYPES.includes(file.type)
    && !IMAGE_EDIT_ACCEPTED_EXTENSIONS.includes(extension)
  ) {
    return `“${file.name}”的格式不支持，请选择常见图片格式`;
  }
  if (file.size > IMAGE_EDIT_MAX_BYTES) {
    return `“${file.name}”超过 ${IMAGE_EDIT_MAX_MB}MB，请压缩后再上传`;
  }
  return '';
}

export default function ImageGenerationPage() {
  const { pricing } = useCredits();
  const [mode, setMode] = useState('generate');
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('auto');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [resultTitle, setResultTitle] = useState('生成的图片');
  const [sourceImages, setSourceImages] = useState([]);
  const sourceImagesRef = useRef([]);
  const [sourceInputKey, setSourceInputKey] = useState(0);
  const estimatedPoints = pricing?.qwenImage
    ? (size === 'auto' ? pricing.qwenImage.output2K : pricing.qwenImage.output1K)
      + (mode === 'edit' ? sourceImages.length * pricing.qwenImage.inputImage : 0)
    : null;

  useEffect(() => () => {
    sourceImagesRef.current.forEach(({ previewUrl }) => URL.revokeObjectURL(previewUrl));
  }, []);

  const handleModeChange = (nextMode) => {
    setMode(nextMode);
    setError('');
    setImageUrl('');
    setResultTitle(nextMode === 'edit' ? '编辑后的图片' : '生成的图片');
  };

  const handleSourceImagesChange = (fileList) => {
    setError('');
    setSourceInputKey((current) => current + 1);

    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    if (sourceImages.length + files.length > IMAGE_EDIT_MAX_COUNT) {
      setError(`最多可选择 ${IMAGE_EDIT_MAX_COUNT} 张参考图片`);
      return;
    }

    const validationError = files.map(getSourceImageError).find(Boolean);
    if (validationError) {
      setError(validationError);
      return;
    }

    const addedImages = files.map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setSourceImages((current) => {
      const nextImages = [...current, ...addedImages];
      sourceImagesRef.current = nextImages;
      return nextImages;
    });
  };

  const handleRemoveSourceImage = (previewUrl) => {
    setError('');
    setSourceImages((current) => {
      const removedImage = current.find((image) => image.previewUrl === previewUrl);
      if (removedImage) URL.revokeObjectURL(removedImage.previewUrl);
      const nextImages = current.filter((image) => image.previewUrl !== previewUrl);
      sourceImagesRef.current = nextImages;
      return nextImages;
    });
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
      if (sourceImages.length === 0) {
        setError('请至少选择一张参考图片');
        return;
      }
      if (sourceImages.length > IMAGE_EDIT_MAX_COUNT) {
        setError(`最多可选择 ${IMAGE_EDIT_MAX_COUNT} 张参考图片`);
        return;
      }
      const validationError = sourceImages.map(({ file }) => getSourceImageError(file)).find(Boolean);
      if (validationError) {
        setError(validationError);
        return;
      }
    }

    setIsGenerating(true);
    try {
      const url = mode === 'edit' && sourceImages.length > 0
        ? await editImage({ prompt: prompt.trim(), size, images: sourceImages.map(({ file }) => file) })
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
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="source-images" className="text-sm font-medium">参考图片</label>
                <span className="text-xs text-zinc-500">已选 {sourceImages.length}/{IMAGE_EDIT_MAX_COUNT} 张</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label
                  htmlFor="source-images"
                  className={`flex min-h-[164px] flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 px-4 py-5 text-center text-sm text-zinc-500 transition-colors ${sourceImages.length >= IMAGE_EDIT_MAX_COUNT ? 'cursor-default opacity-70' : 'cursor-pointer hover:border-primary hover:text-primary'}`}
                >
                  <Upload className="mb-2 h-6 w-6" />
                  <span className="font-medium">
                    {sourceImages.length >= IMAGE_EDIT_MAX_COUNT ? '已选满，移除后可继续添加' : (sourceImages.length > 0 ? '继续添加参考图片' : '选择参考图片')}
                  </span>
                  <span className="mt-1 text-xs">可一次选择多张，最多 {IMAGE_EDIT_MAX_COUNT} 张</span>
                  <span className="mt-1 text-xs">每张不超过 {IMAGE_EDIT_MAX_MB}MB</span>
                  <input
                    key={sourceInputKey}
                    id="source-images"
                    type="file"
                    accept={[
                      ...IMAGE_EDIT_ACCEPTED_MIME_TYPES,
                      ...IMAGE_EDIT_ACCEPTED_EXTENSIONS.map((extension) => `.${extension}`),
                    ].join(',')}
                    multiple
                    disabled={sourceImages.length >= IMAGE_EDIT_MAX_COUNT}
                    className="sr-only"
                    onChange={(event) => handleSourceImagesChange(event.target.files)}
                  />
                </label>

                {sourceImages.map(({ file, previewUrl }, index) => (
                  <div key={previewUrl} className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900">
                    <div className="relative">
                      <NextImage src={previewUrl} alt={`第 ${index + 1} 张参考图片：${file.name}`} width={512} height={132} unoptimized className="h-[132px] w-full object-contain" />
                      <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-1 text-xs text-white">第 {index + 1} 张</span>
                      <button type="button" onClick={() => handleRemoveSourceImage(previewUrl)} className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" aria-label={`移除第 ${index + 1} 张参考图片`}>
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="truncate px-3 py-2 text-xs text-zinc-500" title={file.name}>{file.name}</p>
                  </div>
                ))}
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
          {Number.isInteger(estimatedPoints) ? (
            <p className="text-center text-xs text-zinc-500">预计约消耗 {estimatedPoints.toLocaleString('zh-CN')} 积分，完成后按实际费用结算</p>
          ) : null}
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
