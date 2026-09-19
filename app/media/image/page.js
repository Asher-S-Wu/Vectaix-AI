'use client';

import UseInChatButton from '@/app/components/media/UseInChatButton';
import { useEffect, useRef, useState } from 'react';
import NextImage from 'next/image';
import { AnimatePresence, motion } from 'framer-motion';
import { ImagePlus, Loader2, RefreshCw, Sparkles, Upload, Wand2, X } from 'lucide-react';
import ImageResultCard from '@/app/components/media/image-result-card';
import { editImage, generateImage } from '@/lib/media/client/media';
import {
  IMAGE_MODEL,
  IMAGE_MODEL_OPTIONS,
  getImageModelConfig,
  getImageModelOption,
  validateImageOptions,
  validateImageReferences,
} from '@/lib/media/shared/models';

export default function ImageGenerationPage() {
  const [mode, setMode] = useState('generate');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState(IMAGE_MODEL);
  const [sizesByModel, setSizesByModel] = useState(() => Object.fromEntries(
    IMAGE_MODEL_OPTIONS.map(({ id }) => [id, getImageModelConfig(id).defaultSize]),
  ));
  const [isGenerating, setIsGenerating] = useState(false);
  const requestControllerRef = useRef(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [resultTitle, setResultTitle] = useState('生成的图片');
  const [sourceImages, setSourceImages] = useState([]);
  const sourceImagesRef = useRef([]);
  const [sourceInputKey, setSourceInputKey] = useState(0);
  const modelConfig = getImageModelConfig(model);
  const modelOption = getImageModelOption(model);
  const size = sizesByModel[modelOption.id];
  const selectedOptions = { model, size, ...(modelConfig.fixedQuality ? { quality: modelConfig.fixedQuality } : {}) };
  let optionsError = '';
  let referenceError = '';
  try {
    validateImageOptions(selectedOptions);
  } catch (validationError) {
    optionsError = validationError.message;
  }
  if (mode === 'edit') {
    try {
      validateImageReferences(model, sourceImages.map(({ file }) => file), { requireImages: true });
    } catch (validationError) {
      referenceError = validationError.message;
    }
  }
  const validationError = optionsError || referenceError;
  const displayedError = error || validationError;

  useEffect(() => () => {
    const controller = requestControllerRef.current;
    requestControllerRef.current = null;
    controller?.abort();
    sourceImagesRef.current.forEach(({ previewUrl }) => URL.revokeObjectURL(previewUrl));
  }, []);

  const handleModeChange = (nextMode) => {
    setMode(nextMode);
    setError('');
    setNotice('');
    setImageUrl('');
    setResultTitle(nextMode === 'edit' ? '编辑后的图片' : '生成的图片');
  };

  const handleModelChange = (nextModel) => {
    setModel(nextModel);
    setError('');
  };

  const handleSizeChange = (value) => {
    setSizesByModel((current) => ({
      ...current,
      [modelOption.id]: value,
    }));
    setError('');
  };

  const handleSourceImagesChange = (fileList) => {
    setError('');
    setSourceInputKey((current) => current + 1);

    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    try {
      validateImageReferences(model, [...sourceImages.map(({ file }) => file), ...files]);
    } catch (validationError) {
      setError(validationError.message);
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
    if (requestControllerRef.current) return;
    setError('');
    setNotice('');

    if (!prompt.trim()) {
      setError('请输入图片描述');
      return;
    }

    if (prompt.trim().length > modelConfig.promptMaxLength) {
      setError(`描述最多支持 ${modelConfig.promptMaxLength} 个字符`);
      return;
    }

    let options;
    try {
      options = validateImageOptions(selectedOptions);
      if (mode === 'edit') {
        validateImageReferences(model, sourceImages.map(({ file }) => file), { requireImages: true });
      }
    } catch (validationError) {
      setError(validationError.message);
      return;
    }

    const controller = new AbortController();
    requestControllerRef.current = controller;
    setIsGenerating(true);
    try {
      const url = mode === 'edit'
        ? await editImage({ prompt: prompt.trim(), ...options, images: sourceImages.map(({ file }) => file) }, { signal: controller.signal })
        : await generateImage({ prompt: prompt.trim(), ...options }, { signal: controller.signal });
      if (controller.signal.aborted || requestControllerRef.current !== controller) return;
      setImageUrl(url);
      setResultTitle(mode === 'edit' ? '编辑后的图片' : '生成的图片');
    } catch (generateError) {
      if (controller.signal.aborted || requestControllerRef.current !== controller) return;
      setError(generateError instanceof Error ? generateError.message : '图片处理失败，请稍后再试');
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
        setIsGenerating(false);
      }
    }
  };

  const handleCancel = () => {
    const controller = requestControllerRef.current;
    if (!controller || controller.signal.aborted) return;
    controller.abort();
    setNotice('已取消本次请求');
  };

  return (
    <div className="space-y-6">
      <div className="glass-effect rounded-2xl border border-zinc-200/60 dark:border-zinc-800/60 p-5">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Wand2 className="h-5 w-5" /></span>
          <div>
            <h2 className="text-lg font-semibold">图片生成</h2>
            <p className="text-sm text-zinc-500">使用 {modelConfig.name}，生成新图片或编辑已有图片。</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <AnimatePresence initial={false}>
            {displayedError ? (
              <motion.div
                key="form-error"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                  <span role="alert">{displayedError}</span>
                  {!validationError ? (
                    <button type="submit" disabled={isGenerating} className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline disabled:opacity-50">
                      <RefreshCw className="h-3 w-3" /> 重试
                    </button>
                  ) : null}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <div className="space-y-2">
            <label htmlFor="image-model" className="text-sm font-medium">图片模型</label>
            <select id="image-model" value={modelOption.id} onChange={(event) => handleModelChange(event.target.value)} className="h-11 w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 text-sm outline-none cursor-pointer transition-colors hover:border-zinc-300 focus:border-primary">
              {IMAGE_MODEL_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
            </select>
          </div>

          {modelOption.modes.length > 0 ? (
            <div className="space-y-2">
              <label htmlFor="image-generation-mode" className="text-sm font-medium">生成模式</label>
              <select id="image-generation-mode" value={model} onChange={(event) => handleModelChange(event.target.value)} className="h-11 w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 text-sm outline-none cursor-pointer transition-colors hover:border-zinc-300 focus:border-primary">
                {modelOption.modes.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </div>
          ) : null}

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
                <span className="text-xs text-zinc-500">已选 {sourceImages.length}/{modelConfig.maxReferenceImages} 张</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label
                  htmlFor="source-images"
                  className={`flex min-h-[164px] flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 px-4 py-5 text-center text-sm text-zinc-500 transition-colors ${sourceImages.length >= modelConfig.maxReferenceImages ? 'cursor-default opacity-70' : 'cursor-pointer hover:border-primary hover:text-primary'}`}
                >
                  <Upload className="mb-2 h-6 w-6" />
                  <span className="font-medium">
                    {sourceImages.length >= modelConfig.maxReferenceImages ? '已选满，移除后可继续添加' : (sourceImages.length > 0 ? '继续添加参考图片' : '选择参考图片')}
                  </span>
                  <span className="mt-1 text-xs">可一次选择多张，最多 {modelConfig.maxReferenceImages} 张</span>
                  <span className="mt-1 text-xs">每张不超过 {modelConfig.maxImageBytes / (1024 * 1024)}MB，合计不超过 {modelConfig.maxTotalImageBytes / (1024 * 1024)}MB</span>
                  {modelConfig.service === 'micu' ? <span className="mt-1 text-xs">支持 PNG、JPEG、WebP</span> : null}
                  <input
                    key={sourceInputKey}
                    id="source-images"
                    type="file"
                    accept={[
                      ...modelConfig.mimeTypes,
                      ...modelConfig.extensions.map((extension) => `.${extension}`),
                    ].join(',')}
                    multiple
                    disabled={sourceImages.length >= modelConfig.maxReferenceImages}
                    className="sr-only"
                    onChange={(event) => handleSourceImagesChange(event.target.files)}
                  />
                </label>

                {sourceImages.map(({ file, previewUrl }, index) => (
                  <div key={previewUrl} className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900">
                    <div className="relative h-[132px]">
                      <NextImage src={previewUrl} alt={`第 ${index + 1} 张参考图片：${file.name}`} fill sizes="(max-width: 639px) 100vw, (max-width: 1023px) 50vw, 25vw" unoptimized className="object-contain" />
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
            <textarea id="image-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={modelConfig.promptMaxLength} placeholder={mode === 'edit' ? '描述你想修改的地方' : '描述你想生成的画面'} className="min-h-[140px] w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-sm outline-none focus:border-primary" />
            <div className="text-right text-xs text-zinc-500">{prompt.length}/{modelConfig.promptMaxLength}</div>
          </div>

          <div className="space-y-2">
            <label htmlFor="image-size" className="text-sm font-medium">图片比例</label>
            <select id="image-size" value={size} onChange={(event) => handleSizeChange(event.target.value)} className="h-11 w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 text-sm outline-none cursor-pointer transition-colors hover:border-zinc-300 focus:border-primary">
              {modelConfig.sizes.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </div>

          <UseInChatButton section="image" value={selectedOptions} disabled={isGenerating || Boolean(optionsError)} />
          <button type="submit" disabled={isGenerating || Boolean(validationError)} className="btn-primary flex h-12 w-full items-center justify-center gap-2 rounded-xl font-medium disabled:opacity-60">
            {isGenerating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
            {isGenerating ? '处理中…' : (mode === 'edit' ? '编辑图片' : '生成图片')}
          </button>
          {isGenerating ? (
            <button type="button" onClick={handleCancel} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-zinc-300 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
              <X className="h-4 w-4" /> 取消
            </button>
          ) : null}
          {notice ? <p role="status" className="text-sm text-zinc-500">{notice}</p> : null}
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
            {mode === 'edit' ? '正在编辑图片，请稍候…' : '正在生成图片，请稍候…'}
          </div>
          <div className="relative flex h-[320px] items-center justify-center overflow-hidden rounded-xl border border-primary/20 bg-primary/5">
            <div aria-hidden className="absolute inset-0 animate-pulse bg-gradient-to-br from-primary/10 via-transparent to-primary/10" />
            <div className="relative flex flex-col items-center gap-3 text-primary/70">
              <ImagePlus className="h-10 w-10 animate-pulse" />
              <span className="text-xs">正在处理图片，请保持页面打开</span>
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
          <p className="text-sm font-medium text-zinc-500">{mode === 'edit' ? '编辑后的图片会显示在这里' : '生成的图片会显示在这里'}</p>
          <p className="text-xs text-zinc-400">{mode === 'edit' ? '上传参考图片，描述修改要求，点击「编辑图片」。' : '输入画面描述，点击「生成图片」。'}</p>
        </div>
      )}
    </div>
  );
}
