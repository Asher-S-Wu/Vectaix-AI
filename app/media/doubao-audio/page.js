"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AudioLines,
  Captions,
  ChevronDown,
  FileAudio2,
  Loader2,
  SlidersHorizontal,
  Sparkles,
  Upload,
  WandSparkles,
  Waves,
} from "lucide-react";
import AudioFormError from "@/app/components/media/AudioFormError";
import AudioGeneratingBanner from "@/app/components/media/AudioGeneratingBanner";
import AudioHistorySection from "@/app/components/media/AudioHistorySection";
import AudioSliderField from "@/app/components/media/AudioSliderField";
import AudioSourceClipField from "@/app/components/media/AudioSourceClipField";
import AudioWorkspaceHero from "@/app/components/media/AudioWorkspaceHero";
import AudioWorkspaceTabs from "@/app/components/media/AudioWorkspaceTabs";
import DoubaoAudioGenerationCard from "@/app/components/media/DoubaoAudioGenerationCard";
import MediaConfirmDialog from "@/app/components/media/MediaConfirmDialog";
import {
  createDoubaoAudioGeneration,
  deleteDoubaoAudioGeneration,
  listDoubaoAudioGenerations,
} from "@/lib/media/client/media";
import {
  AUDIO_UPLOAD_ACCEPT,
  AUDIO_UPLOAD_EXTENSIONS,
  AUDIO_UPLOAD_MAX_BYTES,
  AUDIO_UPLOAD_PURPOSES,
} from "@/lib/media/shared/audioUploads";
import {
  DOUBAO_AUDIO_FORMAT_OPTIONS,
  DOUBAO_AUDIO_MODEL,
  DOUBAO_AUDIO_MODEL_NAME,
  DOUBAO_AUDIO_MODES,
  DOUBAO_AUDIO_REFERENCE_MAX_COUNT,
  DOUBAO_AUDIO_TEXT_MAX_LENGTH,
} from "@/lib/media/shared/doubaoAudio";

const AUDIO_EXTENSION_SET = new Set(AUDIO_UPLOAD_EXTENSIONS);

const MODE_TABS = DOUBAO_AUDIO_MODES.map((item) => ({
  id: item.id,
  label: item.label,
  icon: item.id === "text" ? Sparkles : FileAudio2,
}));

function mergeGeneration(items, nextGeneration) {
  return [nextGeneration, ...items.filter((item) => item.id !== nextGeneration.id)].slice(0, 100);
}

function fileExtension(name) {
  const match = /\.([^.]+)$/.exec(String(name || "").toLowerCase());
  return match ? match[1] : "";
}

export default function DoubaoAudioWorkspacePage() {
  const reduceMotion = useReducedMotion();
  const textAreaRef = useRef(null);
  const audioInputRef = useRef(null);
  const [mode, setMode] = useState("text");
  const [textPrompt, setTextPrompt] = useState("");
  const [audioReferences, setAudioReferences] = useState([]);
  const [format, setFormat] = useState("mp3");
  const [speechRate, setSpeechRate] = useState(0);
  const [enableSubtitle, setEnableSubtitle] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const [generations, setGenerations] = useState([]);
  const [generationsLoading, setGenerationsLoading] = useState(true);
  const [generationsError, setGenerationsError] = useState("");
  const [latestGenerationId, setLatestGenerationId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletingId, setDeletingId] = useState("");

  const loadGenerations = useCallback(async () => {
    setGenerationsLoading(true);
    setGenerationsError("");
    try {
      setGenerations(await listDoubaoAudioGenerations());
    } catch (error) {
      setGenerationsError(error instanceof Error ? error.message : "读取 Doubao 音频记录失败");
    } finally {
      setGenerationsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(loadGenerations, 0);
    return () => window.clearTimeout(timer);
  }, [loadGenerations]);

  const changeMode = (nextMode) => {
    if (generating || nextMode === mode) return;
    setMode(nextMode);
    setAudioReferences([]);
    setGenerationError("");
    if (audioInputRef.current) audioInputRef.current.value = "";
  };

  const addAudioReferences = (files) => {
    const incoming = Array.from(files || []);
    if (!incoming.length) return;
    if (audioReferences.length + incoming.length > DOUBAO_AUDIO_REFERENCE_MAX_COUNT) {
      setGenerationError("最多只能上传 3 段参考音频");
      return;
    }
    for (const file of incoming) {
      if (!AUDIO_EXTENSION_SET.has(fileExtension(file.name))) {
        setGenerationError(`${file.name} 的格式不受支持`);
        return;
      }
      if (file.size <= 0) {
        setGenerationError(`${file.name} 的内容为空`);
        return;
      }
      if (file.size > AUDIO_UPLOAD_MAX_BYTES) {
        setGenerationError(`${file.name} 不能超过 100MB`);
        return;
      }
    }
    const next = incoming.map((file) => ({
      id: crypto.randomUUID(),
      file,
      source: null,
    }));
    setAudioReferences((current) => [...current, ...next]);
    setGenerationError("");
  };

  const removeAudioReference = (index) => {
    const number = index + 1;
    setAudioReferences((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setTextPrompt((current) => current.replace(/@音频(\d+)/gu, (tag, value) => {
      const referenced = Number(value);
      if (referenced === number) return "";
      return referenced > number ? `@音频${referenced - 1}` : tag;
    }));
  };

  const insertAudioTag = (index) => {
    const tag = `@音频${index + 1}`;
    const textarea = textAreaRef.current;
    const start = textarea?.selectionStart ?? textPrompt.length;
    const end = textarea?.selectionEnd ?? start;
    const next = `${textPrompt.slice(0, start)}${tag}${textPrompt.slice(end)}`;
    if (next.length > DOUBAO_AUDIO_TEXT_MAX_LENGTH) {
      setGenerationError("提示词最多支持 3000 个字符");
      return;
    }
    setTextPrompt(next);
    window.requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + tag.length, start + tag.length);
    });
  };

  const handleGenerate = async (event) => {
    event.preventDefault();
    setGenerationError("");
    const normalizedPrompt = textPrompt.trim();
    if (!normalizedPrompt) {
      setGenerationError("请输入音频描述或待合成文本");
      textAreaRef.current?.focus();
      return;
    }
    if (mode === "audio-reference" && !audioReferences.length) {
      setGenerationError("请上传至少一段参考音频");
      return;
    }
    if (mode === "audio-reference" && audioReferences.some((item) => item.source?.status !== "ready")) {
      setGenerationError("请等待所有参考音频上传和识别完成");
      return;
    }
    const availableAudioReferences = mode === "audio-reference" ? audioReferences.length : 0;
    for (const match of normalizedPrompt.matchAll(/@音频(\d+)/gu)) {
      const referenceNumber = Number(match[1]);
      if (referenceNumber < 1 || referenceNumber > availableAudioReferences) {
        setGenerationError(`提示词引用了不存在的 @音频${match[1]}`);
        return;
      }
    }

    setGenerating(true);
    try {
      const generation = await createDoubaoAudioGeneration({
        mode,
        textPrompt: normalizedPrompt,
        referenceAudios: mode === "audio-reference"
          ? audioReferences.map((item) => ({
              fileId: item.source.upload.fileId,
              clipStart: item.source.clipStart,
              clipEnd: item.source.clipEnd,
            }))
          : [],
        format,
        speechRate,
        enableSubtitle,
      });
      setGenerations((current) => mergeGeneration(current, generation));
      setLatestGenerationId(generation.id);
      setGenerationsError("");
      setAudioReferences([]);
      setTextPrompt((current) => current.replace(/@音频\d+/gu, "").replace(/ {2,}/gu, " ").trim());
      if (audioInputRef.current) audioInputRef.current.value = "";
    } catch (error) {
      const message = error instanceof Error ? error.message : "Doubao 音频生成失败";
      setGenerationError(mode === "audio-reference"
        ? `${message}。临时参考音频已清理，请重新选择`
        : message);
      if (mode === "audio-reference") setAudioReferences([]);
      if (audioInputRef.current) audioInputRef.current.value = "";
    } finally {
      setGenerating(false);
    }
  };

  const confirmDelete = async () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target || deletingId) return;
    setDeletingId(target.id);
    try {
      await deleteDoubaoAudioGeneration(target.id);
      setGenerations((current) => current.filter((item) => item.id !== target.id));
      setLatestGenerationId((current) => current === target.id ? "" : current);
    } catch (error) {
      setGenerationsError(error instanceof Error ? error.message : "删除 Doubao 音频记录失败");
    } finally {
      setDeletingId("");
    }
  };

  const latestGeneration = generations.find((item) => item.id === latestGenerationId) || null;
  const history = latestGeneration ? generations.filter((item) => item.id !== latestGeneration.id) : generations;

  return (
    <div className="space-y-6">
      <AudioWorkspaceHero
        icon={AudioLines}
        title="Doubao 音频工作台"
        badge="1.0"
        description="用文字或参考音频创作配音、音效和场景声。"
        modelLabel={`${DOUBAO_AUDIO_MODEL_NAME} · ${DOUBAO_AUDIO_MODEL}`}
      >
        <AudioWorkspaceTabs
          idPrefix="doubao-audio"
          tabs={MODE_TABS}
          activeTab={mode}
          onChange={changeMode}
          ariaLabel="Doubao 音频生成方式"
        />
      </AudioWorkspaceHero>

      <div className="space-y-6">
        <section className="glass-effect rounded-2xl border border-zinc-200/60 p-5 dark:border-zinc-800/60 sm:p-6">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">创作音频</h2>
              <p className="mt-1 text-sm text-zinc-500">用文字描述音效、配音或场景，也可以加入参考音频。</p>
            </div>
            <span className="hidden items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1.5 text-xs text-zinc-500 dark:bg-zinc-800 sm:inline-flex">
              <Waves className="h-3.5 w-3.5 text-primary" />
              最长 120 秒
            </span>
          </div>

          <form onSubmit={handleGenerate} className="space-y-5">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
              <div className="space-y-3">
                <div className="flex items-end justify-between gap-3">
                  <label htmlFor="doubao-audio-prompt" className="text-sm font-medium">音频描述或文本</label>
                  <span className={`text-right text-xs ${textPrompt.length >= DOUBAO_AUDIO_TEXT_MAX_LENGTH ? "text-red-600" : "text-zinc-500"}`}>
                    {textPrompt.length.toLocaleString("zh-CN")} / {DOUBAO_AUDIO_TEXT_MAX_LENGTH.toLocaleString("zh-CN")} 字符
                  </span>
                </div>
                <textarea
                  ref={textAreaRef}
                  id="doubao-audio-prompt"
                  value={textPrompt}
                  maxLength={DOUBAO_AUDIO_TEXT_MAX_LENGTH}
                  onChange={(event) => {
                    setTextPrompt(event.target.value);
                    setGenerationError("");
                  }}
                  placeholder={mode === "audio-reference" ? "例如：使用 @音频1 的音色朗读这段旁白，前 2 秒加入雨声。" : "例如：生成 15 秒的雨夜街道环境音，远处偶尔传来汽车声。"}
                  className="focus-ring min-h-[260px] w-full resize-y rounded-2xl border border-zinc-200 bg-white px-4 py-4 text-sm leading-7 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900"
                />
                {mode === "audio-reference" && audioReferences.length ? (
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">插入参考音频标签</span>
                      <span className="text-[11px] text-zinc-400">标签从光标位置生效</span>
                    </div>
                    <div className="flex flex-wrap gap-2" aria-label="参考音频标签">
                      {audioReferences.map((_, index) => (
                        <button
                          key={index}
                          type="button"
                          onClick={() => insertAudioTag(index)}
                          className="inline-flex h-8 items-center rounded-lg border border-zinc-200 bg-white px-2.5 text-xs font-medium text-primary transition-[border-color,background-color,transform] hover:border-primary/40 hover:bg-primary/5 active:scale-[0.97] dark:border-zinc-700 dark:bg-zinc-900"
                        >
                          插入 @音频{index + 1}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="space-y-3">
                {mode === "text" ? (
                  <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/70 px-5 text-center dark:border-zinc-800 dark:bg-zinc-900/40">
                    <Waves className="h-8 w-8 text-primary" />
                    <p className="mt-3 text-sm font-medium">无需参考素材</p>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">直接描述声音、时长、情绪和时间轴即可。</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {audioReferences.map((item, index) => (
                      <AudioSourceClipField
                        key={item.id}
                        file={item.file}
                        purpose={AUDIO_UPLOAD_PURPOSES.DOUBAO_REFERENCE}
                        label={`@音频${index + 1}`}
                        disabled={generating}
                        onStateChange={(source) => {
                          setAudioReferences((current) => current.map((candidate) => (
                            candidate.id === item.id ? { ...candidate, source } : candidate
                          )));
                        }}
                        onRemove={() => removeAudioReference(index)}
                      />
                    ))}
                    {audioReferences.length < DOUBAO_AUDIO_REFERENCE_MAX_COUNT ? (
                      <button
                        type="button"
                        disabled={generating}
                        onClick={() => audioInputRef.current?.click()}
                        className="flex min-h-24 w-full flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 text-sm text-zinc-500 transition-colors hover:border-primary hover:text-primary disabled:opacity-50 dark:border-zinc-700"
                      >
                        <Upload className="mb-2 h-5 w-5" />
                        上传参考音频
                        <span className="mt-1 text-[11px] text-zinc-400">常见音频格式，单个最大 100MB、最长 30 分钟</span>
                      </button>
                    ) : null}
                    <input
                      ref={audioInputRef}
                      type="file"
                      accept={AUDIO_UPLOAD_ACCEPT}
                      multiple
                      disabled={generating}
                      className="sr-only"
                      onChange={(event) => {
                        addAudioReferences(event.target.files);
                        event.target.value = "";
                      }}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setAdvancedOpen((current) => !current)}
                aria-expanded={advancedOpen}
                aria-controls="doubao-advanced-settings"
                className="flex h-12 w-full items-center justify-between gap-3 px-4 text-left text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-900"
              >
                <span className="flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4 text-primary" />
                  音频设置
                </span>
                <span className="flex items-center gap-2 text-xs font-normal text-zinc-500">
                  {format.toUpperCase()}
                  {enableSubtitle ? " · 字幕" : ""}
                  <ChevronDown className={`h-4 w-4 transition-transform motion-reduce:transition-none ${advancedOpen ? "rotate-180" : ""}`} />
                </span>
              </button>

              <AnimatePresence initial={false}>
                {advancedOpen ? (
                  <motion.div
                    id="doubao-advanced-settings"
                    initial={reduceMotion ? false : { opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="border-t border-zinc-200 bg-zinc-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <label htmlFor="doubao-format" className="text-xs font-medium text-zinc-600 dark:text-zinc-300">输出格式</label>
                          <select
                            id="doubao-format"
                            value={format}
                            onChange={(event) => setFormat(event.target.value)}
                            className="focus-ring h-10 w-full cursor-pointer rounded-xl border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                          >
                            {DOUBAO_AUDIO_FORMAT_OPTIONS.map((item) => (
                              <option key={item.id} value={item.id}>{item.label}</option>
                            ))}
                          </select>
                        </div>
                        <AudioSliderField
                          id="doubao-speech-rate"
                          label="语速"
                          value={speechRate}
                          valueLabel={speechRate}
                          min={-50}
                          max={100}
                          step={1}
                          onChange={(event) => setSpeechRate(Number(event.target.value))}
                          icon={AudioLines}
                        />
                      </div>
                      <label className="mt-4 flex cursor-pointer items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-3 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                        <input
                          type="checkbox"
                          checked={enableSubtitle}
                          onChange={(event) => setEnableSubtitle(event.target.checked)}
                          className="h-4 w-4 accent-primary"
                        />
                        <Captions className="h-4 w-4 text-primary" />
                        生成字幕
                      </label>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>

            <AudioFormError message={generationError} />

            <button
              type="submit"
              disabled={generating || (mode === "audio-reference" && audioReferences.some((item) => item.source?.status !== "ready"))}
              className="btn-primary inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl font-medium disabled:opacity-60"
            >
              {generating ? <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" /> : <WandSparkles className="h-5 w-5" />}
              {generating ? "正在生成音频…" : "生成音频"}
            </button>
            <div className="sr-only" aria-live="polite">
              {generating ? "正在生成音频，请稍候" : latestGeneration ? "音频已经生成并保存" : ""}
            </div>
          </form>
        </section>

        {generating ? (
          <AudioGeneratingBanner />
        ) : latestGeneration ? (
          <section className="space-y-3" aria-labelledby="latest-doubao-audio-title">
            <div>
              <h2 id="latest-doubao-audio-title" className="text-base font-semibold">本次结果</h2>
              <p className="mt-1 text-sm text-zinc-500">音频已经保存，可以直接播放或下载。</p>
            </div>
            <DoubaoAudioGenerationCard
              generation={latestGeneration}
              featured
              deleting={deletingId === latestGeneration.id}
              deleteDisabled={Boolean(deletingId)}
              onDelete={setDeleteTarget}
            />
          </section>
        ) : null}

        <AudioHistorySection
          title="音频记录"
          totalCount={generations.length}
          items={history}
          loading={generationsLoading}
          error={generationsError}
          onRefresh={loadGenerations}
          emptyTitle="还没有音频记录"
          emptyDescription="在上方描述声音并生成音频，结果会安全保存在这里。"
          renderItem={(generation) => (
            <DoubaoAudioGenerationCard
              key={generation.id}
              generation={generation}
              deleting={deletingId === generation.id}
              deleteDisabled={Boolean(deletingId)}
              onDelete={setDeleteTarget}
            />
          )}
        />
      </div>

      <MediaConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="删除音频记录"
        message="确定删除这条音频吗？音频文件也会一并删除，之后无法恢复。"
        confirmText="删除音频"
        danger
      />
    </div>
  );
}
