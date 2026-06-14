'use client';

import { useEffect, useState } from 'react';
import { ImagePlus, Sparkles, Upload, X } from 'lucide-react';
import ImageResultCard from '@/app/components/media/image-result-card';
import { editImage, generateImage } from '@/lib/media/client/media';
import {
  IMAGE_EDIT_ACCEPTED_MIME_TYPES,
  IMAGE_EDIT_MAX_BYTES,
  IMAGE_ICON_URL,
  IMAGE_MODEL_NAME,
  IMAGE_PROMPT_MAX_LENGTH,
  IMAGE_SIZE_OPTIONS,
} from '@/lib/media/shared/models';

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

  useEffect(() => {
    if (!sourceImage) {
      setSourcePreviewUrl('');
      return undefined;
    }
    const nextUrl = URL.createObjectURL(sourceImage);
    setSourcePreviewUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [sourceImage]);

  const handleModeChange = (nextMode) => {
    setMode(nextMode);
    setError('');
    setImageUrl('');
    setResultTitle(nextMode === 'edit' ? '编辑后的图片' : '生成的图片');
  };

  const handleSourceImageChange = (file) => {
    setError('');
    setSourceImage(file);
    if (!file) setSourceInputKey((current) => current + 1);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setImageUrl('');

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
        setError('图片大小不能超过 25MB');
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
          <img src={IMAGE_ICON_URL} alt="" className="h-10 w-10 object-contain" />
          <div>
            <h2 className="text-lg font-semibold">图片生成</h2>
            <p className="text-sm text-zinc-500">使用 {IMAGE_MODEL_NAME}，生成新图片或编辑已有图片。</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div> : null}

          <div className="grid grid-cols-2 gap-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-100/70 dark:bg-zinc-900/70 p-1">
            <button type="button" onClick={() => handleModeChange('generate')} className={`flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-semibold ${mode === 'generate' ? 'bg-white dark:bg-zinc-800 shadow-sm' : 'text-zinc-500'}`}>
              <Sparkles className="h-4 w-4" /> 生成图片
            </button>
            <button type="button" onClick={() => handleModeChange('edit')} className={`flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-semibold ${mode === 'edit' ? 'bg-white dark:bg-zinc-800 shadow-sm' : 'text-zinc-500'}`}>
              <ImagePlus className="h-4 w-4" /> 编辑图片
            </button>
          </div>

          {mode === 'edit' ? (
            <div className="space-y-2">
              <label htmlFor="source-image" className="text-sm font-medium">参考图片</label>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
                <label htmlFor="source-image" className="flex min-h-[132px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 px-4 py-5 text-center text-sm text-zinc-500">
                  <Upload className="mb-2 h-6 w-6" />
                  <span className="font-medium">{sourceImage ? sourceImage.name : '上传 PNG、JPG 或 WEBP'}</span>
                  <span className="mt-1 text-xs">最大 25MB</span>
                  <input key={sourceInputKey} id="source-image" type="file" accept={IMAGE_EDIT_ACCEPTED_MIME_TYPES.join(',')} className="sr-only" onChange={(event) => handleSourceImageChange(event.target.files?.[0] || null)} />
                </label>
                <div className="relative overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900">
                  {sourcePreviewUrl ? (
                    <>
                      <img src={sourcePreviewUrl} alt="参考图片" className="h-[132px] w-full object-contain" />
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
            <select id="image-size" value={size} onChange={(event) => setSize(event.target.value)} className="h-11 w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 text-sm outline-none">
              {IMAGE_SIZE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </div>

          <button type="submit" disabled={isGenerating} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900">
            <Sparkles className="h-5 w-5" />
            {isGenerating ? '处理中...' : (mode === 'edit' ? '编辑图片' : '生成图片')}
          </button>
        </form>
      </div>

      <ImageResultCard imageUrl={imageUrl} title={resultTitle} />
    </div>
  );
}
