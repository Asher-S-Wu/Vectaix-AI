"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AudioLines,
  AudioWaveform,
  ChevronDown,
  Gauge,
  Languages,
  Loader2,
  Mic2,
  SlidersHorizontal,
  Sparkles,
  Volume2,
  WandSparkles,
} from "lucide-react";
import AudioFormError from "@/app/components/media/AudioFormError";
import AudioGeneratingBanner from "@/app/components/media/AudioGeneratingBanner";
import AudioHistorySection from "@/app/components/media/AudioHistorySection";
import AudioSliderField from "@/app/components/media/AudioSliderField";
import AudioWorkspaceHero from "@/app/components/media/AudioWorkspaceHero";
import AudioWorkspaceTabs from "@/app/components/media/AudioWorkspaceTabs";
import MediaConfirmDialog from "@/app/components/media/MediaConfirmDialog";
import MinimaxAudioGenerationCard from "@/app/components/media/MinimaxAudioGenerationCard";
import MinimaxVoiceClonePanel from "@/app/components/media/MinimaxVoiceClonePanel";
import VoicePicker, {
  mapMinimaxCustomVoice,
  mapMinimaxSystemVoice,
} from "@/app/components/media/VoicePicker";
import {
  createMinimaxAudioGeneration,
  createMinimaxVoice,
  deleteMinimaxAudioGeneration,
  deleteMinimaxVoice,
  listMinimaxAudioGenerations,
  listMinimaxVoices,
  renameMinimaxVoice,
} from "@/lib/media/client/media";
import {
  getMinimaxAudioModel,
  MINIMAX_AUDIO_DEFAULT_MODEL,
  MINIMAX_AUDIO_EMOTION_OPTIONS,
  MINIMAX_AUDIO_FORMAT_OPTIONS,
  MINIMAX_AUDIO_LANGUAGE_OPTIONS,
  MINIMAX_AUDIO_MODELS,
  MINIMAX_AUDIO_SAMPLE_RATE_OPTIONS,
  MINIMAX_AUDIO_TEXT_MAX_LENGTH,
  MINIMAX_EXPRESSIVE_TAGS,
} from "@/lib/media/shared/minimaxAudio";

function merge(items, item) {
  return [item, ...items.filter((current) => current.id !== item.id)].slice(0, 100);
}

export default function MinimaxAudioWorkspacePage() {
  const reduceMotion = useReducedMotion();
  const textRef = useRef(null);
  const [activeTab, setActiveTab] = useState("synthesis");
  const [text, setText] = useState("");
  const [model, setModel] = useState(MINIMAX_AUDIO_DEFAULT_MODEL);
  const [voiceId, setVoiceId] = useState("");
  const [emotion, setEmotion] = useState("");
  const [speed, setSpeed] = useState(1);
  const [volume, setVolume] = useState(1);
  const [pitch, setPitch] = useState(0);
  const [languageBoost, setLanguageBoost] = useState("");
  const [format, setFormat] = useState("mp3");
  const [sampleRate, setSampleRate] = useState(32000);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const [generations, setGenerations] = useState([]);
  const [generationsLoading, setGenerationsLoading] = useState(true);
  const [generationsError, setGenerationsError] = useState("");
  const [latestId, setLatestId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletingId, setDeletingId] = useState("");
  const [systemVoices, setSystemVoices] = useState([]);
  const [customVoices, setCustomVoices] = useState([]);
  const [voicesLoading, setVoicesLoading] = useState(true);
  const [voicesError, setVoicesError] = useState("");

  const loadGenerations = useCallback(async () => {
    setGenerationsLoading(true);
    setGenerationsError("");
    try {
      setGenerations(await listMinimaxAudioGenerations());
    } catch (error) {
      setGenerationsError(error instanceof Error ? error.message : "读取 MiniMax 语音记录失败");
    } finally {
      setGenerationsLoading(false);
    }
  }, []);

  const loadVoices = useCallback(async () => {
    setVoicesLoading(true);
    setVoicesError("");
    try {
      const voices = await listMinimaxVoices();
      setSystemVoices(voices.systemVoices);
      setCustomVoices(voices.customVoices);
      setVoiceId((current) => {
        const available = [...voices.systemVoices, ...voices.customVoices];
        return available.some((voice) => voice.voiceId === current)
          ? current
          : available[0]?.voiceId || "";
      });
    } catch (error) {
      setVoicesError(error instanceof Error ? error.message : "读取 MiniMax 音色失败");
    } finally {
      setVoicesLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadGenerations();
      loadVoices();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadGenerations, loadVoices]);

  const allVoices = useMemo(() => [...systemVoices, ...customVoices], [systemVoices, customVoices]);
  const selectedVoice = allVoices.find((voice) => voice.voiceId === voiceId) || null;
  const latest = generations.find((item) => item.id === latestId) || null;
  const history = latest ? generations.filter((item) => item.id !== latest.id) : generations;

  const closeVoicePicker = useCallback(() => setVoicePickerOpen(false), []);
  const selectVoice = useCallback((voice) => {
    setVoiceId(voice.voiceId);
    setGenerationError("");
  }, []);

  const voiceButtonDescription = selectedVoice
    ? (selectedVoice.kind === "custom"
      ? "我的复刻音色"
      : (Array.isArray(selectedVoice.description) && selectedVoice.description.length
        ? selectedVoice.description.join(" · ")
        : "系统音色"))
    : "从系统音色或我的音色中选择";

  const insertTag = (tag) => {
    const textarea = textRef.current;
    const start = textarea?.selectionStart ?? text.length;
    const end = textarea?.selectionEnd ?? start;
    const next = `${text.slice(0, start)}${tag}${text.slice(end)}`;
    if (next.length > MINIMAX_AUDIO_TEXT_MAX_LENGTH) {
      setGenerationError(`合成文本最多支持 ${MINIMAX_AUDIO_TEXT_MAX_LENGTH.toLocaleString("zh-CN")} 个字符`);
      return;
    }
    setText(next);
    setGenerationError("");
    window.requestAnimationFrame(() => {
      textarea?.focus();
      const cursor = start + tag.length;
      textarea?.setSelectionRange(cursor, cursor);
    });
  };

  const handleGenerate = async (event) => {
    event.preventDefault();
    const normalized = text.trim();
    setGenerationError("");
    if (!normalized) {
      setGenerationError("请输入需要合成的文字");
      textRef.current?.focus();
      return;
    }
    if (normalized.length > MINIMAX_AUDIO_TEXT_MAX_LENGTH) {
      setGenerationError(`合成文本最多支持 ${MINIMAX_AUDIO_TEXT_MAX_LENGTH.toLocaleString("zh-CN")} 个字符`);
      return;
    }
    if (!voiceId) {
      setGenerationError("请选择一个音色");
      return;
    }
    setGenerating(true);
    try {
      const generation = await createMinimaxAudioGeneration({
        text: normalized,
        model,
        voiceId,
        emotion,
        speed,
        volume,
        pitch,
        languageBoost,
        format,
        sampleRate,
      });
      setGenerations((current) => merge(current, generation));
      setLatestId(generation.id);
      setGenerationsError("");
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "MiniMax 语音生成失败");
    } finally {
      setGenerating(false);
    }
  };

  const confirmDeleteGeneration = async () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    setDeletingId(target.id);
    setGenerationsError("");
    try {
      await deleteMinimaxAudioGeneration(target.id);
      setGenerations((current) => current.filter((item) => item.id !== target.id));
      setLatestId((current) => current === target.id ? "" : current);
    } catch (error) {
      setGenerationsError(error instanceof Error ? error.message : "删除 MiniMax 语音记录失败");
    } finally {
      setDeletingId("");
    }
  };

  const handleCreateVoice = async (input) => {
    const voice = await createMinimaxVoice(input);
    setCustomVoices((current) => merge(current, voice));
    setVoiceId(voice.voiceId);
    setVoicesError("");
    return voice;
  };

  const handleRenameVoice = async (voice, displayName) => {
    const updated = await renameMinimaxVoice(voice.id, displayName);
    setCustomVoices((current) => current.map((item) => item.id === updated.id ? updated : item));
    setVoicesError("");
    return updated;
  };

  const handleDeleteVoice = async (voice) => {
    await deleteMinimaxVoice(voice.id);
    const remaining = customVoices.filter((item) => item.id !== voice.id);
    setCustomVoices(remaining);
    if (voice.voiceId === voiceId) {
      setVoiceId(systemVoices[0]?.voiceId || remaining[0]?.voiceId || "");
    }
    setVoicesError("");
  };

  const currentModel = getMinimaxAudioModel(model);

  return (
    <div className="space-y-6">
      <AudioWorkspaceHero
        icon={AudioWaveform}
        title="MiniMax 语音工作台"
        badge="2.8"
        description="使用系统音色或你的专属声音，把文字变成自然、有情绪的语音。"
        modelLabel="Speech 2.8 HD · Turbo"
      >
        <AudioWorkspaceTabs
          idPrefix="minimax-audio"
          tabs={[
            { id: "synthesis", label: "语音合成", icon: WandSparkles },
            { id: "cloning", label: "声音复刻", icon: Mic2 },
          ]}
          activeTab={activeTab}
          onChange={setActiveTab}
          ariaLabel="MiniMax 语音功能"
        />
      </AudioWorkspaceHero>

      {activeTab === "synthesis" ? (
        <div id="minimax-audio-panel-synthesis" role="tabpanel" aria-labelledby="minimax-audio-tab-synthesis" className="space-y-6">
          <section className="glass-effect rounded-2xl border border-zinc-200/60 p-5 dark:border-zinc-800/60 sm:p-6">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">创作语音</h2>
                <p className="mt-1 text-sm text-zinc-500">输入内容、挑选音色，再按需要调整情感与声音参数。</p>
              </div>
              <span className="hidden items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1.5 text-xs text-zinc-500 dark:bg-zinc-800 sm:inline-flex">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                非实时高品质合成
              </span>
            </div>

            <form onSubmit={handleGenerate} className="space-y-5">
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
                <div className="space-y-3">
                  <div className="flex items-end justify-between gap-3">
                    <label htmlFor="minimax-text" className="text-sm font-medium">合成文本</label>
                    <span className={`text-right text-xs ${text.length >= MINIMAX_AUDIO_TEXT_MAX_LENGTH ? "text-red-600" : "text-zinc-500"}`}>
                      预计计费 {text.length.toLocaleString("zh-CN")} / {MINIMAX_AUDIO_TEXT_MAX_LENGTH.toLocaleString("zh-CN")} 字符
                    </span>
                  </div>
                  <textarea
                    ref={textRef}
                    id="minimax-text"
                    value={text}
                    onChange={(event) => {
                      setText(event.target.value);
                      setGenerationError("");
                    }}
                    maxLength={MINIMAX_AUDIO_TEXT_MAX_LENGTH}
                    placeholder="输入想让声音朗读的内容。可以是一段旁白、课程讲解，也可以是一整章故事。"
                    className="focus-ring min-h-[260px] w-full resize-y rounded-2xl border border-zinc-200 bg-white px-4 py-4 text-sm leading-7 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">插入表现力标签</span>
                      <span className="text-[11px] text-zinc-400">标签从光标位置生效</span>
                    </div>
                    <div className="flex flex-wrap gap-2" aria-label="表现力标签">
                      {MINIMAX_EXPRESSIVE_TAGS.map((tag) => (
                        <button
                          key={tag.value}
                          type="button"
                          onClick={() => insertTag(tag.value)}
                          className="inline-flex h-8 items-center rounded-lg border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-600 transition-[border-color,background-color,transform] hover:border-primary/40 hover:bg-primary/5 hover:text-primary active:scale-[0.97] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                          title={`插入 ${tag.value}`}
                        >
                          {tag.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-5">
                  <div className="space-y-2">
                    <span className="text-sm font-medium">音色</span>
                    <button
                      type="button"
                      onClick={() => setVoicePickerOpen(true)}
                      className="group flex min-h-[112px] w-full items-center gap-3 rounded-2xl border border-zinc-200 bg-white/70 p-4 text-left transition-[border-color,background-color,transform] hover:border-primary/50 hover:bg-primary/[0.03] active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900/70"
                      aria-haspopup="dialog"
                    >
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                        <Mic2 className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                          {voicesLoading ? "正在读取音色…" : selectedVoice?.name || "请选择音色"}
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-zinc-500">
                          {voiceButtonDescription}
                        </span>
                      </span>
                      <ChevronDown className="-rotate-90 h-4 w-4 shrink-0 text-zinc-400 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
                    </button>
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="minimax-emotion" className="text-sm font-medium">情感</label>
                    <select
                      id="minimax-emotion"
                      value={emotion}
                      onChange={(event) => setEmotion(event.target.value)}
                      disabled={generating}
                      className="focus-ring h-11 w-full cursor-pointer rounded-xl border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      {MINIMAX_AUDIO_EMOTION_OPTIONS.map((item) => (
                        <option key={item.id || "auto"} value={item.id}>{item.label}</option>
                      ))}
                    </select>
                    <p className="text-xs leading-5 text-zinc-500">默认根据文字自动判断情绪，也可以手动指定。</p>
                  </div>
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((current) => !current)}
                  aria-expanded={advancedOpen}
                  aria-controls="minimax-advanced-settings"
                  className="flex h-12 w-full items-center justify-between gap-3 px-4 text-left text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-900"
                >
                  <span className="flex items-center gap-2">
                    <SlidersHorizontal className="h-4 w-4 text-primary" />
                    声音设置
                  </span>
                  <span className="flex items-center gap-2 text-xs font-normal text-zinc-500">
                    {currentModel?.label || model} · {format.toUpperCase()} · {sampleRate / 1000}kHz
                    <ChevronDown className={`h-4 w-4 transition-transform motion-reduce:transition-none ${advancedOpen ? "rotate-180" : ""}`} />
                  </span>
                </button>

                <AnimatePresence initial={false}>
                  {advancedOpen ? (
                    <motion.div
                      id="minimax-advanced-settings"
                      initial={reduceMotion ? false : { opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-zinc-200 bg-zinc-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                          <div className="space-y-2">
                            <label htmlFor="minimax-model" className="text-xs font-medium text-zinc-600 dark:text-zinc-300">生成模型</label>
                            <select
                              id="minimax-model"
                              value={model}
                              onChange={(event) => setModel(event.target.value)}
                              disabled={generating}
                              className="focus-ring h-10 w-full cursor-pointer rounded-xl border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                            >
                              {MINIMAX_AUDIO_MODELS.map((item) => (
                                <option key={item.id} value={item.id}>{item.label} · {item.price}</option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-2">
                            <label htmlFor="minimax-language" className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                              <Languages className="h-3.5 w-3.5 text-primary" />
                              语言增强
                            </label>
                            <select
                              id="minimax-language"
                              value={languageBoost}
                              onChange={(event) => setLanguageBoost(event.target.value)}
                              disabled={generating}
                              className="focus-ring h-10 w-full cursor-pointer rounded-xl border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                            >
                              {MINIMAX_AUDIO_LANGUAGE_OPTIONS.map((item) => (
                                <option key={item.id || "none"} value={item.id}>{item.label}</option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-2">
                            <label htmlFor="minimax-format" className="text-xs font-medium text-zinc-600 dark:text-zinc-300">音频格式</label>
                            <select
                              id="minimax-format"
                              value={format}
                              onChange={(event) => setFormat(event.target.value)}
                              disabled={generating}
                              className="focus-ring h-10 w-full cursor-pointer rounded-xl border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                            >
                              {MINIMAX_AUDIO_FORMAT_OPTIONS.map((item) => (
                                <option key={item.id} value={item.id}>{item.label}</option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-2">
                            <label htmlFor="minimax-sample-rate" className="text-xs font-medium text-zinc-600 dark:text-zinc-300">采样率</label>
                            <select
                              id="minimax-sample-rate"
                              value={sampleRate}
                              onChange={(event) => setSampleRate(Number(event.target.value))}
                              disabled={generating}
                              className="focus-ring h-10 w-full cursor-pointer rounded-xl border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                            >
                              {MINIMAX_AUDIO_SAMPLE_RATE_OPTIONS.map((item) => (
                                <option key={item.id} value={item.id}>{item.label}</option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                          <AudioSliderField
                            id="minimax-speed"
                            label="语速"
                            valueLabel={`${speed.toFixed(1)}×`}
                            icon={Gauge}
                            min={0.5}
                            max={2}
                            step={0.1}
                            value={speed}
                            onChange={(event) => setSpeed(Number(event.target.value))}
                            disabled={generating}
                          />
                          <AudioSliderField
                            id="minimax-volume"
                            label="音量"
                            valueLabel={volume.toFixed(1)}
                            icon={Volume2}
                            min={0.1}
                            max={10}
                            step={0.1}
                            value={volume}
                            onChange={(event) => setVolume(Number(event.target.value))}
                            disabled={generating}
                          />
                          <AudioSliderField
                            id="minimax-pitch"
                            label="音高"
                            valueLabel={`${pitch > 0 ? "+" : ""}${pitch}`}
                            icon={AudioLines}
                            min={-12}
                            max={12}
                            step={1}
                            value={pitch}
                            onChange={(event) => setPitch(Number(event.target.value))}
                            disabled={generating}
                          />
                        </div>
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>

              <AudioFormError message={generationError || voicesError} />

              <button
                type="submit"
                disabled={generating || voicesLoading || !voiceId}
                className="btn-primary inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl font-medium disabled:opacity-60"
              >
                {generating ? <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" /> : <WandSparkles className="h-5 w-5" />}
                {generating ? "正在生成语音…" : "生成语音"}
              </button>
              <div className="sr-only" aria-live="polite">
                {generating ? "正在生成语音，请稍候" : latest ? "语音已经生成并保存" : ""}
              </div>
            </form>
          </section>

          {generating ? (
            <AudioGeneratingBanner />
          ) : latest ? (
            <section className="space-y-3" aria-labelledby="latest-minimax-audio-title">
              <div>
                <h2 id="latest-minimax-audio-title" className="text-base font-semibold">本次结果</h2>
                <p className="mt-1 text-sm text-zinc-500">音频已经保存，可以直接播放或下载。</p>
              </div>
              <MinimaxAudioGenerationCard
                generation={latest}
                featured
                deleting={deletingId === latest.id}
                deleteDisabled={Boolean(deletingId)}
                onDelete={setDeleteTarget}
              />
            </section>
          ) : null}

          <AudioHistorySection
            totalCount={generations.length}
            items={history}
            loading={generationsLoading}
            error={generationsError}
            onRefresh={loadGenerations}
            emptyDescription="在上方输入文字并生成语音，结果会安全保存在这里。"
            renderItem={(generation) => (
              <MinimaxAudioGenerationCard
                key={generation.id}
                generation={generation}
                deleting={deletingId === generation.id}
                deleteDisabled={Boolean(deletingId)}
                onDelete={setDeleteTarget}
              />
            )}
          />
        </div>
      ) : (
        <div id="minimax-audio-panel-cloning" role="tabpanel" aria-labelledby="minimax-audio-tab-cloning">
          <MinimaxVoiceClonePanel
            voices={customVoices}
            loading={voicesLoading}
            error={voicesError}
            onCreate={handleCreateVoice}
            onRename={handleRenameVoice}
            onDelete={handleDeleteVoice}
            onRefresh={loadVoices}
          />
        </div>
      )}

      <VoicePicker
        open={voicePickerOpen}
        brandLabel="MiniMax Speech"
        selectedVoiceId={voiceId}
        presetSection={{
          title: "系统音色",
          description: "MiniMax 官方音色，覆盖多语种与多风格。",
          voices: systemVoices.map(mapMinimaxSystemVoice),
          loading: voicesLoading,
          error: voicesError,
          emptyTitle: "暂未获取到系统音色",
          emptyDescription: "关闭面板后点击历史区刷新，或稍后重试。",
        }}
        customSection={{
          title: "我的音色",
          description: "在“声音复刻”中创建的专属声音。",
          voices: customVoices.map(mapMinimaxCustomVoice),
          loading: voicesLoading,
          emptyTitle: "还没有复刻音色",
          emptyDescription: "关闭面板后切换到“声音复刻”即可创建。",
        }}
        onClose={closeVoicePicker}
        onSelect={selectVoice}
      />

      <MediaConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除语音记录"
        message="确定删除这条 MiniMax 语音吗？对应音频文件也会一起删除，无法恢复。"
        confirmText="删除语音"
        danger
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDeleteGeneration}
      />
    </div>
  );
}
