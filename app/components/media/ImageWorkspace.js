'use client';

import { useI18n } from "@/lib/client/i18n";

import Select from '@/app/components/common/Select';
import ApplyGlobalMediaButton from '@/app/components/media/ApplyGlobalMediaButton';
import { useEffect, useRef, useState } from 'react';
import NextImage from 'next/image';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ImagePlus, Loader2, RefreshCw, Sparkles, Upload, X } from 'lucide-react';
import ImageResults from '@/app/components/media/ImageResults';
import ImageHistory from '@/app/components/media/ImageHistory';
import MediaWorkspaceHeading from '@/app/components/media/MediaWorkspaceHeading';
import { editImage, generateImage } from '@/lib/media/client/media';
import {
  getImageCountOptions,
  IMAGE_MODEL,
  IMAGE_MODEL_OPTIONS,
  getImageModelConfig,
  getImageModelOption,
  validateImageOptions,
  validateImageReferences,
} from '@/lib/media/shared/models';

export default function ImageWorkspace({ canManageDefaults = false, serviceEnabled = true }) {
  const { t, locale, formatNumber, localizeMessage } = useI18n();

  const reduceMotion = useReducedMotion();
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
  const [requestFailed, setRequestFailed] = useState(false);
  const [results, setResults] = useState([]);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [count, setCount] = useState(1);
  const [submittedCount, setSubmittedCount] = useState(1);
  const [resultMode, setResultMode] = useState('generate');
  const resultTitle = resultMode === 'edit' ? t('编辑后的图片', 'Edited image') : t('生成的图片', 'Generated image');
  const [sourceImages, setSourceImages] = useState([]);
  const sourceImagesRef = useRef([]);
  const [sourceInputKey, setSourceInputKey] = useState(0);
  const modelConfig = getImageModelConfig(model, locale);
  const modelOption = getImageModelOption(model, locale);
  const size = sizesByModel[modelOption.id];
  const selectedOptions = { model, size, count, ...(modelConfig.fixedQuality ? { quality: modelConfig.fixedQuality } : {}) };
  let optionsError = '';
  let referenceError = '';
  try {
    validateImageOptions(selectedOptions, locale);
  } catch (validationError) {
    optionsError = validationError.message;
  }
  const missingReferences = mode === 'edit' && sourceImages.length === 0;
  if (mode === 'edit' && !missingReferences) {
    try {
      validateImageReferences(model, sourceImages.map(({ file }) => file), { requireImages: true, locale });
    } catch (validationError) {
      referenceError = validationError.message;
    }
  }
  const validationError = optionsError || referenceError;
  const displayedError = Array.isArray(error) ? t(...error) : localizeMessage(error || validationError);

  useEffect(() => () => {
    const controller = requestControllerRef.current;
    requestControllerRef.current = null;
    controller?.abort();
    sourceImagesRef.current.forEach(({ previewUrl }) => URL.revokeObjectURL(previewUrl));
  }, []);

  const handleModeChange = (nextMode) => {
    setMode(nextMode);
    setError('');
    setRequestFailed(false);
    setNotice('');
    setResults([]);
    setResultMode(nextMode);
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
      validateImageReferences(model, [...sourceImages.map(({ file }) => file), ...files], { locale });
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
    if (!serviceEnabled || requestControllerRef.current) return;
    setError('');
    setRequestFailed(false);
    setNotice('');

    if (!prompt.trim()) {
      setError(["请输入图片描述", "Enter an image description"]);
      return;
    }

    if (prompt.trim().length > modelConfig.promptMaxLength) {
      setError(["描述最多支持 {count} 个字符", "Descriptions can contain up to {count} characters", { count: formatNumber(modelConfig.promptMaxLength) }]);
      return;
    }

    let options;
    try {
      options = validateImageOptions(selectedOptions, locale);
      if (mode === 'edit') {
        validateImageReferences(model, sourceImages.map(({ file }) => file), { requireImages: true, locale });
      }
    } catch (validationError) {
      setError(validationError.message);
      return;
    }

    const controller = new AbortController();
    requestControllerRef.current = controller;
    setIsGenerating(true);
    setResults([]);
    setSubmittedCount(options.count);
    try {
      const generated = mode === 'edit'
        ? await editImage({ prompt: prompt.trim(), ...options, images: sourceImages.map(({ file }) => file) }, { signal: controller.signal })
        : await generateImage({ prompt: prompt.trim(), ...options }, { signal: controller.signal });
      if (controller.signal.aborted || requestControllerRef.current !== controller) return;
      setResults(generated);
      setHistoryRevision(value => value + 1);
      setResultMode(mode);
    } catch (generateError) {
      if (controller.signal.aborted || requestControllerRef.current !== controller) return;
      if (generateError.results) setResults(generateError.results);
      setRequestFailed(true);
      setError(generateError instanceof Error ? generateError.message : ["图片处理失败，请稍后再试", "Image processing failed. Please try again later."]);
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
    setNotice(["已取消本次请求", "Request cancelled"]);
  };

  return (
    <div className="space-y-6">
      <MediaWorkspaceHeading title={t("图片生成", "Image generation")} description={t("用文字描绘画面，或上传参考图片进行编辑。", "Describe an image to generate it, or upload reference images to edit.")} modelLabel={modelConfig.name} />
      <div className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6 dark:border-zinc-700">

        <form onSubmit={handleSubmit} className="space-y-5">
          <AnimatePresence initial={false}>
            {displayedError ? (
              <motion.div
                key="form-error"
                initial={reduceMotion ? false : { opacity: 0, height: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.2 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:text-red-300">
                  <span role="alert">{displayedError}</span>
                  {requestFailed && !validationError ? (
                    <button type="submit" disabled={isGenerating} className="shrink-0 inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-950/50">
                      <RefreshCw className="h-3 w-3" /> {t("重试", "Retry")} </button>
                  ) : null}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <div role="group" aria-label={t("处理方式", "Mode")} className="relative grid grid-cols-2 gap-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-100 p-1">
            <button type="button" aria-pressed={mode === 'generate'} disabled={isGenerating} onClick={() => handleModeChange('generate')} className={`relative flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors ${mode === 'generate' ? 'text-zinc-800' : 'text-zinc-500 hover:text-zinc-700'}`}>
              {mode === 'generate' && (
                <motion.span
                  layoutId="image-mode-pill"
                  transition={reduceMotion ? { duration: 0 } : { type: 'spring', damping: 28, stiffness: 320 }}
                  className="selection-surface absolute inset-0 rounded-lg"
                />
              )}
              <span className="relative flex items-center gap-2"><Sparkles className="h-4 w-4" /> {t("生成图片", "Generate image")}</span>
            </button>
            <button type="button" aria-pressed={mode === 'edit'} disabled={isGenerating} onClick={() => handleModeChange('edit')} className={`relative flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors ${mode === 'edit' ? 'text-zinc-800' : 'text-zinc-500 hover:text-zinc-700'}`}>
              {mode === 'edit' && (
                <motion.span
                  layoutId="image-mode-pill"
                  transition={reduceMotion ? { duration: 0 } : { type: 'spring', damping: 28, stiffness: 320 }}
                  className="selection-surface absolute inset-0 rounded-lg"
                />
              )}
              <span className="relative flex items-center gap-2"><ImagePlus className="h-4 w-4" /> {t("编辑图片", "Edit image")}</span>
            </button>
          </div>

          <div className="space-y-2">
            <label htmlFor="image-model" className="text-sm font-medium">{t("图片模型", "Image model")}</label>
            <Select disabled={isGenerating} id="image-model" value={modelOption.id} onChange={handleModelChange} size="lg" options={IMAGE_MODEL_OPTIONS.map(option => ({
  id: option.id,
  label: option.name
}))} />
          </div>

          {modelOption.modes.length > 0 ? (
            <div className="space-y-2">
              <label htmlFor="image-generation-mode" className="text-sm font-medium">{t("生成模式", "Generation mode")}</label>
              <Select disabled={isGenerating} id="image-generation-mode" value={model} onChange={handleModelChange} size="lg" options={modelOption.modes} />
            </div>
          ) : null}

          <AnimatePresence initial={false}>
          {mode === 'edit' ? (
            <motion.div initial={reduceMotion ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: reduceMotion ? 0 : 0.24 }} style={{ overflow: "hidden" }} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="source-images" className="text-sm font-medium">{t("参考图片", "Reference images")}</label>
                <span className="text-xs text-zinc-500">{t("已选 {count}/{max} 张", "{count}/{max} images selected", { count: formatNumber(sourceImages.length), max: formatNumber(modelConfig.maxReferenceImages) })}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label
                  htmlFor="source-images"
                  className={`flex min-h-[164px] flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 px-4 py-5 text-center text-sm text-zinc-500 transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30 ${sourceImages.length >= modelConfig.maxReferenceImages || isGenerating ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:border-primary hover:text-primary'}`}
                >
                  <Upload className="mb-2 h-6 w-6" />
                  <span className="font-medium">
                    {sourceImages.length >= modelConfig.maxReferenceImages ? t("已选满，移除后可继续添加", "Limit reached. Remove an image to add another.") : (sourceImages.length > 0 ? t("继续添加参考图片", "Add more reference images") : t("选择参考图片", "Choose reference images"))}
                  </span>
                  <span className="mt-1 text-xs">{t("可一次选择多张，最多 {count} 张", "Select multiple images, up to {count} in total", { count: formatNumber(modelConfig.maxReferenceImages) })}</span>
                  <span className="mt-1 text-xs">{t("每张最多 {single} MB，合计最多 {total} MB", "Up to {single} MB per image and {total} MB in total", { single: formatNumber(modelConfig.maxImageBytes / (1024 * 1024)), total: formatNumber(modelConfig.maxTotalImageBytes / (1024 * 1024)) })}</span>
                  {modelConfig.service === 'micu' ? <span className="mt-1 text-xs">{t("支持 PNG、JPEG、WebP", "PNG, JPEG, and WebP supported")}</span> : null}
                  <input
                    key={sourceInputKey}
                    id="source-images"
                    type="file"
                    accept={[
                      ...modelConfig.mimeTypes,
                      ...modelConfig.extensions.map((extension) => `.${extension}`),
                    ].join(',')}
                    multiple
                    disabled={isGenerating || sourceImages.length >= modelConfig.maxReferenceImages}
                    className="sr-only"
                    onChange={(event) => handleSourceImagesChange(event.target.files)}
                  />
                </label>

                {sourceImages.map(({ file, previewUrl }, index) => (
                  <div key={previewUrl} className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50">
                    <div className="relative h-[132px]">
                      <NextImage src={previewUrl} alt={t("第 {index} 张参考图片：{name}", "Reference image {index}: {name}", { index: formatNumber(index + 1), name: file.name })} fill sizes="(max-width: 639px) 100vw, (max-width: 1023px) 50vw, 25vw" unoptimized className="object-contain" />
                      <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-1 text-xs text-white">{t("第 {index} 张", "Image {index}", { index: formatNumber(index + 1) })}</span>
                      <button type="button" disabled={isGenerating} onClick={() => handleRemoveSourceImage(previewUrl)} className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50" aria-label={t("移除第 {index} 张参考图片", "Remove reference image {index}", { index: formatNumber(index + 1) })}>
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="truncate px-3 py-2 text-xs text-zinc-500" title={file.name}>{file.name}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          ) : null}
          </AnimatePresence>

          <div className="space-y-2">
            <label htmlFor="image-prompt" className="text-sm font-medium">{t("图片描述", "Image description")}</label>
            <textarea id="image-prompt" disabled={isGenerating} value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={modelConfig.promptMaxLength} placeholder={mode === 'edit' ? t("描述你想修改的地方", "Describe what you want to change") : t("描述你想生成的画面", "Describe the image you want to create")} className="min-h-[140px] w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white px-4 py-3 text-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60" />
            <div aria-live="polite" className="text-right text-xs tabular-nums text-zinc-500">{formatNumber(prompt.length)}/{formatNumber(modelConfig.promptMaxLength)}</div>
          </div>

          <div className="space-y-2">
            <label htmlFor="image-size" className="text-sm font-medium">{t("图片比例", "Image aspect ratio")}</label>
            <Select disabled={isGenerating} id="image-size" value={size} onChange={handleSizeChange} size="lg" options={modelConfig.sizes} />
          </div>

          <div className="space-y-2">
            <label htmlFor="image-count" className="text-sm font-medium">{t("图片数量", "Image count")}</label>
            <Select id="image-count" ariaLabel={t("图片数量", "Image count")} value={count} onChange={setCount} options={getImageCountOptions(locale)} disabled={isGenerating} size="lg" />
          </div>
          {canManageDefaults && <ApplyGlobalMediaButton section="image" value={selectedOptions} disabled={isGenerating || Boolean(optionsError)} />}
          {missingReferences && <p className="text-sm text-zinc-500">{t("先添加至少 1 张参考图片。", "Add at least one reference image first.")}</p>}
          <button type="submit" disabled={!serviceEnabled || isGenerating || Boolean(validationError) || missingReferences} className="btn-primary flex h-12 w-full items-center justify-center gap-2 rounded-xl font-medium disabled:cursor-not-allowed disabled:opacity-60">
            {isGenerating ? <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" /> : <Sparkles className="h-5 w-5" />}
            {isGenerating ? t("处理中…", "Processing…") : (mode === 'edit' ? t("编辑图片", "Edit image") : t("生成图片", "Generate image"))}
          </button>
          {isGenerating ? (
            <button type="button" onClick={handleCancel} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-zinc-300 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100">
              <X className="h-4 w-4" /> {t("取消", "Cancel")} </button>
          ) : null}
          {notice ? <p role="status" className="text-sm text-zinc-500">{t(...notice)}</p> : null}
        </form>
      </div>

      {isGenerating ? (
        <ImageResults loading count={submittedCount} title={mode === 'edit' ? t("正在编辑图片，请稍候…", "Editing images…") : t("正在生成图片，请稍候…", "Generating images…")} />
      ) : results.length ? (
        <ImageResults results={results} title={resultTitle} />
      ) : (
        <div className="rounded-2xl border border-dashed border-zinc-300 p-8 flex flex-col items-center justify-center text-center gap-2">
          <p className="text-sm font-medium text-zinc-600">{mode === 'edit' ? t("编辑后的图片会显示在这里", "Your edited images will appear here") : t("生成的图片会显示在这里", "Your generated images will appear here")}</p>
          <p className="text-xs text-zinc-500">{mode === 'edit' ? t("上传参考图片，描述修改要求，点击「编辑图片」。", "Upload reference images, describe your changes, then select “Edit image”.") : t("输入画面描述，点击「生成图片」。", "Describe an image, then select “Generate image”.")}</p>
        </div>
      )}
      <ImageHistory refreshKey={historyRevision} onDeleted={fileId => setResults(current => current.filter(image => image.fileId !== fileId))} />
    </div>
  );
}
