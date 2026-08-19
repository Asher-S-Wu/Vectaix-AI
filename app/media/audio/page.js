"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AudioLines,
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
import AudioGenerationCard from "@/app/components/media/AudioGenerationCard";
import AudioHistorySection from "@/app/components/media/AudioHistorySection";
import AudioSliderField from "@/app/components/media/AudioSliderField";
import AudioWorkspaceHero from "@/app/components/media/AudioWorkspaceHero";
import AudioWorkspaceTabs from "@/app/components/media/AudioWorkspaceTabs";
import MediaConfirmDialog from "@/app/components/media/MediaConfirmDialog";
import MediaSelect from "@/app/components/media/MediaSelect";
import VoiceClonePanel from "@/app/components/media/VoiceClonePanel";
import VoicePicker, {
  mapQwenCustomVoice,
  mapRecommendedVoice,
  RECOMMENDED_AUDIO_VOICES,
} from "@/app/components/media/VoicePicker";
import {
  createAudioGeneration,
  createCustomVoice,
  deleteAudioGeneration,
  deleteCustomVoice,
  getCustomVoice,
  listAudioGenerations,
  listCustomVoices,
  updateCustomVoice,
} from "@/lib/media/client/media";
import {
  AUDIO_FORMAT_OPTIONS,
  AUDIO_INSTRUCTION_MAX_LENGTH,
  AUDIO_LANGUAGE_HINTS,
  AUDIO_SAMPLE_RATE_OPTIONS,
  AUDIO_TEXT_MAX_LENGTH,
} from "@/lib/media/shared/models";

const EXPRESSIVE_TAGS = [
  { label: "兴奋", value: "[excited]", kind: "情感" },
  { label: "悲伤", value: "[sad]", kind: "情感" },
  { label: "严肃", value: "[serious]", kind: "情感" },
  { label: "耳语", value: "[whispers]", kind: "风格" },
  { label: "大笑", value: "[laughing]", kind: "声音" },
  { label: "叹息", value: "[sighing]", kind: "声音" },
];

const DEFAULT_VOICE = {
  voiceId: RECOMMENDED_AUDIO_VOICES[0].voiceId,
  name: RECOMMENDED_AUDIO_VOICES[0].name,
  kind: "preset",
  description: `${RECOMMENDED_AUDIO_VOICES[0].trait} · ${RECOMMENDED_AUDIO_VOICES[0].scene}`,
  languages: RECOMMENDED_AUDIO_VOICES[0].languageIds,
};

const PRESET_VOICE_ITEMS = RECOMMENDED_AUDIO_VOICES.map(mapRecommendedVoice);

function mergeGeneration(items, nextGeneration) {
  const withoutCurrent = items.filter((item) => item.id !== nextGeneration.id);
  return [nextGeneration, ...withoutCurrent].slice(0, 100);
}

function mergeVoice(items, nextVoice) {
  const exists = items.some((item) => item.id === nextVoice.id);
  if (!exists) return [nextVoice, ...items];
  return items.map((item) => (item.id === nextVoice.id ? nextVoice : item));
}

export default function AudioWorkspacePage() {
  const reduceMotion = useReducedMotion();
  const textAreaRef = useRef(null);
  const generationsStateVersionRef = useRef(0);
  const generationsRequestRef = useRef(0);
  const voicesStateVersionRef = useRef(0);
  const voicesRequestRef = useRef(0);
  const [activeTab, setActiveTab] = useState("synthesis");
  const [text, setText] = useState("");
  const [selectedVoice, setSelectedVoice] = useState(DEFAULT_VOICE);
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [format, setFormat] = useState("mp3");
  const [sampleRate, setSampleRate] = useState(24000);
  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1);
  const [volume, setVolume] = useState(50);
  const [languageHint, setLanguageHint] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const [latestGenerationId, setLatestGenerationId] = useState("");

  const [generations, setGenerations] = useState([]);
  const [generationsLoading, setGenerationsLoading] = useState(true);
  const [generationsError, setGenerationsError] = useState("");
  const [deletingGenerationId, setDeletingGenerationId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);

  const [voices, setVoices] = useState([]);
  const [voicesLoading, setVoicesLoading] = useState(true);
  const [voicesError, setVoicesError] = useState("");
  const closeVoicePicker = useCallback(() => setVoicePickerOpen(false), []);
  const selectVoice = useCallback((voice) => {
    setSelectedVoice(voice);
    setGenerationError("");
  }, []);

  const loadGenerations = useCallback(async () => {
    const requestId = generationsRequestRef.current + 1;
    generationsRequestRef.current = requestId;
    const stateVersion = generationsStateVersionRef.current;
    setGenerationsLoading(true);
    setGenerationsError("");
    try {
      const items = await listAudioGenerations();
      if (
        generationsRequestRef.current === requestId
        && generationsStateVersionRef.current === stateVersion
      ) {
        generationsStateVersionRef.current += 1;
        setGenerations(items);
      }
    } catch (loadError) {
      if (generationsRequestRef.current === requestId) {
        setGenerationsError(loadError instanceof Error ? loadError.message : "读取语音记录失败");
      }
    } finally {
      if (generationsRequestRef.current === requestId) {
        setGenerationsLoading(false);
      }
    }
  }, []);

  const loadVoices = useCallback(async () => {
    const requestId = voicesRequestRef.current + 1;
    voicesRequestRef.current = requestId;
    const stateVersion = voicesStateVersionRef.current;
    setVoicesLoading(true);
    setVoicesError("");
    try {
      const items = await listCustomVoices();
      if (
        voicesRequestRef.current === requestId
        && voicesStateVersionRef.current === stateVersion
      ) {
        voicesStateVersionRef.current += 1;
        setVoices(items);
      }
    } catch (loadError) {
      if (voicesRequestRef.current === requestId) {
        setVoicesError(loadError instanceof Error ? loadError.message : "读取复刻音色失败");
      }
    } finally {
      if (voicesRequestRef.current === requestId) {
        setVoicesLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadGenerations();
      loadVoices();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadGenerations, loadVoices]);

  const deployingVoiceKey = useMemo(
    () => voices
      .filter((voice) => voice.status === "DEPLOYING" || voice.reconciliationKind === "update")
      .map((voice) => voice.id)
      .sort()
      .join(","),
    [voices],
  );

  useEffect(() => {
    if (!deployingVoiceKey) return undefined;
    const voiceIds = deployingVoiceKey.split(",");
    let cancelled = false;
    let syncing = false;

    const syncDeployingVoices = async () => {
      if (syncing) return;
      syncing = true;
      const stateVersion = voicesStateVersionRef.current;
      try {
        const refreshedVoices = await Promise.all(voiceIds.map((voiceId) => getCustomVoice(voiceId)));
        if (cancelled || voicesStateVersionRef.current !== stateVersion) return;
        voicesStateVersionRef.current += 1;
        setVoices((current) => refreshedVoices.reduce((items, voice) => mergeVoice(items, voice), current));
        setSelectedVoice((current) => {
          if (!current || current.kind !== "custom") return current;
          const refreshed = refreshedVoices.find((voice) => voice.voiceId === current.voiceId);
          return refreshed ? { ...current, name: refreshed.displayName } : current;
        });
        setVoicesError("");
      } catch (syncError) {
        if (!cancelled) {
          setVoicesError(syncError instanceof Error ? syncError.message : "同步音色状态失败");
        }
      } finally {
        syncing = false;
      }
    };

    const interval = window.setInterval(syncDeployingVoices, 10000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [deployingVoiceKey]);

  const insertExpressiveTag = (tag) => {
    const textarea = textAreaRef.current;
    const start = textarea?.selectionStart ?? text.length;
    const end = textarea?.selectionEnd ?? start;
    const nextText = `${text.slice(0, start)}${tag}${text.slice(end)}`;
    if (nextText.length > AUDIO_TEXT_MAX_LENGTH) {
      setGenerationError(`合成文本最多支持 ${AUDIO_TEXT_MAX_LENGTH.toLocaleString("zh-CN")} 个字符`);
      return;
    }
    setText(nextText);
    setGenerationError("");
    window.requestAnimationFrame(() => {
      textarea?.focus();
      const nextCursor = start + tag.length;
      textarea?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const handleGenerate = async (event) => {
    event.preventDefault();
    setGenerationError("");
    const normalizedText = text.trim();

    if (!normalizedText) {
      setGenerationError("请输入需要合成的文字");
      textAreaRef.current?.focus();
      return;
    }
    if (normalizedText.length > AUDIO_TEXT_MAX_LENGTH) {
      setGenerationError(`合成文本最多支持 ${AUDIO_TEXT_MAX_LENGTH.toLocaleString("zh-CN")} 个字符`);
      return;
    }
    if (!selectedVoice) {
      setGenerationError("请选择一个音色");
      return;
    }
    if (
      selectedVoice.kind === "preset"
      && languageHint
      && !selectedVoice.languages.includes(languageHint)
    ) {
      setGenerationError("当前音色不支持所选目标语言，请改为自动识别或选择音色支持的语言");
      return;
    }
    if (selectedVoice.kind === "custom") {
      const ownedVoice = voices.find((voice) => voice.voiceId === selectedVoice.voiceId);
      if (!ownedVoice) {
        setGenerationError("这个复刻音色已经不存在，请重新选择");
        return;
      }
      if (ownedVoice.status !== "OK" || ownedVoice.requiresAttention) {
        setGenerationError("这个复刻音色还不能使用，请等待制作完成或重新选择");
        return;
      }
    }

    setGenerating(true);
    try {
      const generation = await createAudioGeneration({
        text: normalizedText,
        voiceId: selectedVoice.voiceId,
        instruction: instruction.trim(),
        format,
        sampleRate,
        rate,
        pitch,
        volume,
        languageHint,
      });
      generationsStateVersionRef.current += 1;
      setGenerations((current) => mergeGeneration(current, generation));
      setLatestGenerationId(generation.id);
      setGenerationsError("");
    } catch (generateError) {
      setGenerationError(generateError instanceof Error ? generateError.message : "语音生成失败，请稍后再试");
    } finally {
      setGenerating(false);
    }
  };

  const confirmDeleteGeneration = async () => {
    const generation = deleteTarget;
    setDeleteTarget(null);
    if (!generation || deletingGenerationId) return;
    setDeletingGenerationId(generation.id);
    setGenerationsError("");
    try {
      await deleteAudioGeneration(generation.id);
      generationsStateVersionRef.current += 1;
      setGenerations((current) => current.filter((item) => item.id !== generation.id));
      setLatestGenerationId((current) => (current === generation.id ? "" : current));
    } catch (deleteError) {
      setGenerationsError(deleteError instanceof Error ? deleteError.message : "删除语音记录失败");
    } finally {
      setDeletingGenerationId("");
    }
  };

  const updateVoiceInState = useCallback((voice) => {
    voicesStateVersionRef.current += 1;
    setVoices((current) => mergeVoice(current, voice));
    setSelectedVoice((current) => (
      current?.kind === "custom" && current.voiceId === voice.voiceId
        ? { ...current, name: voice.displayName }
        : current
    ));
    setVoicesError("");
    return voice;
  }, []);

  const handleCreateVoice = useCallback(async (input) => {
    const voice = await createCustomVoice(input);
    return updateVoiceInState(voice);
  }, [updateVoiceInState]);

  const handleRenameVoice = useCallback(async (voice, displayName) => {
    const updatedVoice = await updateCustomVoice(voice.id, { displayName });
    return updateVoiceInState(updatedVoice);
  }, [updateVoiceInState]);

  const handleReplaceVoice = useCallback(async (voice, input) => {
    const updatedVoice = await updateCustomVoice(voice.id, input);
    return updateVoiceInState(updatedVoice);
  }, [updateVoiceInState]);

  const handleDeleteVoice = useCallback(async (voice) => {
    await deleteCustomVoice(voice.id);
    voicesStateVersionRef.current += 1;
    setVoices((current) => current.filter((item) => item.id !== voice.id));
    setSelectedVoice((current) => (
      current?.kind === "custom" && current.voiceId === voice.voiceId ? null : current
    ));
    setVoicesError("");
  }, []);

  const handleRefreshVoice = useCallback(async (voice) => {
    const refreshedVoice = await getCustomVoice(voice.id);
    return updateVoiceInState(refreshedVoice);
  }, [updateVoiceInState]);

  const latestGeneration = generations.find((item) => item.id === latestGenerationId) || null;
  const historyGenerations = latestGeneration
    ? generations.filter((item) => item.id !== latestGeneration.id)
    : generations;
  const selectedLanguageUnsupported = Boolean(
    selectedVoice?.kind === "preset"
    && languageHint
    && !selectedVoice.languages.includes(languageHint),
  );

  return (
    <div className="space-y-6">
      <AudioWorkspaceHero
        icon={AudioLines}
        title="Qwen 语音工作台"
        badge="Plus"
        description="把文字变成自然语音，也可以用自己的声音创建专属音色。"
        modelLabel="qwen-audio-3.0-tts-plus"
      >
        <AudioWorkspaceTabs
          idPrefix="audio"
          tabs={[
            { id: "synthesis", label: "语音合成", icon: WandSparkles },
            { id: "cloning", label: "声音复刻", icon: Mic2 },
          ]}
          activeTab={activeTab}
          onChange={setActiveTab}
          ariaLabel="语音工作台功能"
        />
      </AudioWorkspaceHero>

      {activeTab === "synthesis" ? (
        <div id="audio-panel-synthesis" role="tabpanel" aria-labelledby="audio-tab-synthesis" className="space-y-6">
          <section className="glass-effect rounded-2xl border border-zinc-200/60 p-5 dark:border-zinc-800/60 sm:p-6">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">创作语音</h2>
                <p className="mt-1 text-sm text-zinc-500">输入内容、挑选音色，再按需要调整表达方式。</p>
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
                    <label htmlFor="audio-text" className="text-sm font-medium">合成文本</label>
                    <span className={`text-right text-xs ${text.length >= AUDIO_TEXT_MAX_LENGTH ? "text-red-600" : "text-zinc-500"}`}>
                      预计计费 {text.length.toLocaleString("zh-CN")} / {AUDIO_TEXT_MAX_LENGTH.toLocaleString("zh-CN")} 字符
                    </span>
                  </div>
                  <textarea
                    ref={textAreaRef}
                    id="audio-text"
                    value={text}
                    onChange={(event) => {
                      setText(event.target.value);
                      setGenerationError("");
                    }}
                    maxLength={AUDIO_TEXT_MAX_LENGTH}
                    placeholder="输入想让声音朗读的内容。可以是一段旁白、课程讲解，也可以是一整章故事。"
                    className="focus-ring min-h-[260px] w-full resize-y rounded-2xl border border-zinc-200 bg-white px-4 py-4 text-sm leading-7 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">插入表现力标签</span>
                      <span className="text-[11px] text-zinc-400">标签从光标位置生效</span>
                    </div>
                    <div className="flex flex-wrap gap-2" aria-label="表现力标签">
                      {EXPRESSIVE_TAGS.map((tag) => (
                        <button
                          key={tag.value}
                          type="button"
                          onClick={() => insertExpressiveTag(tag.value)}
                          className="inline-flex h-8 items-center rounded-lg border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-600 transition-[border-color,background-color,transform] hover:border-primary/40 hover:bg-primary/5 hover:text-primary active:scale-[0.97] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                          title={`插入 ${tag.value}（${tag.kind}标签）`}
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
                          {selectedVoice?.name || "请选择音色"}
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-zinc-500">
                          {selectedVoice?.description || "从推荐音色或我的音色中选择"}
                        </span>
                      </span>
                      <ChevronDown className="-rotate-90 h-4 w-4 shrink-0 text-zinc-400 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
                    </button>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <label htmlFor="audio-instruction" className="text-sm font-medium">表达要求</label>
                      <span className="text-xs text-zinc-400">
                        选填 · {instruction.length}/{AUDIO_INSTRUCTION_MAX_LENGTH}
                      </span>
                    </div>
                    <textarea
                      id="audio-instruction"
                      value={instruction}
                      onChange={(event) => setInstruction(event.target.value)}
                      maxLength={AUDIO_INSTRUCTION_MAX_LENGTH}
                      placeholder="例如：温暖自然，语速稍慢，像在讲睡前故事。"
                      className="focus-ring min-h-[118px] w-full resize-y rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-sm leading-6 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900"
                    />
                    <p className="text-xs leading-5 text-zinc-500">用自然语言描述情绪、语速、音调或口音即可。</p>
                  </div>
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((current) => !current)}
                  aria-expanded={advancedOpen}
                  aria-controls="audio-advanced-settings"
                  className="flex h-12 w-full items-center justify-between gap-3 px-4 text-left text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-900"
                >
                  <span className="flex items-center gap-2">
                    <SlidersHorizontal className="h-4 w-4 text-primary" />
                    声音设置
                  </span>
                  <span className="flex items-center gap-2 text-xs font-normal text-zinc-500">
                    {format.toUpperCase()} · {sampleRate / 1000}kHz
                    <ChevronDown className={`h-4 w-4 transition-transform motion-reduce:transition-none ${advancedOpen ? "rotate-180" : ""}`} />
                  </span>
                </button>

                <AnimatePresence initial={false}>
                  {advancedOpen ? (
                    <motion.div
                      id="audio-advanced-settings"
                      initial={reduceMotion ? false : { opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-zinc-200 bg-zinc-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
                        <div className="grid gap-4 sm:grid-cols-3">
                          <div className="space-y-2">
                            <label htmlFor="audio-format" className="text-xs font-medium text-zinc-600 dark:text-zinc-300">音频格式</label>
                            <MediaSelect
                              id="audio-format"
                              ariaLabel="音频格式"
                              value={format}
                              onChange={setFormat}
                              options={AUDIO_FORMAT_OPTIONS}
                            />
                          </div>
                          <div className="space-y-2">
                            <label htmlFor="audio-sample-rate" className="text-xs font-medium text-zinc-600 dark:text-zinc-300">采样率</label>
                            <MediaSelect
                              id="audio-sample-rate"
                              ariaLabel="采样率"
                              value={sampleRate}
                              onChange={setSampleRate}
                              options={AUDIO_SAMPLE_RATE_OPTIONS}
                            />
                          </div>
                          <div className="space-y-2">
                            <label htmlFor="audio-language" className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                              <Languages className="h-3.5 w-3.5 text-primary" />
                              目标语言
                            </label>
                            <MediaSelect
                              id="audio-language"
                              ariaLabel="目标语言"
                              value={languageHint}
                              onChange={setLanguageHint}
                              options={AUDIO_LANGUAGE_HINTS.map((option) => ({
                                id: option.id,
                                label: option.label,
                                disabled: Boolean(
                                  option.id
                                  && selectedVoice?.kind === "preset"
                                  && !selectedVoice.languages.includes(option.id)
                                ),
                              }))}
                            />
                            {selectedLanguageUnsupported ? (
                              <p className="text-[11px] leading-4 text-red-600" role="alert">
                                当前音色不支持这个语言，请改为自动识别或选择支持的语言。
                              </p>
                            ) : null}
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                          <AudioSliderField
                            id="audio-rate"
                            label="语速"
                            value={rate}
                            valueLabel={`${rate.toFixed(1)}×`}
                            min={0.5}
                            max={2}
                            step={0.1}
                            onChange={(event) => setRate(Number(event.target.value))}
                            icon={Gauge}
                          />
                          <AudioSliderField
                            id="audio-pitch"
                            label="音调"
                            value={pitch}
                            valueLabel={`${pitch.toFixed(1)}×`}
                            min={0.5}
                            max={2}
                            step={0.1}
                            onChange={(event) => setPitch(Number(event.target.value))}
                            icon={AudioLines}
                          />
                          <AudioSliderField
                            id="audio-volume"
                            label="音量"
                            value={volume}
                            valueLabel={volume}
                            min={0}
                            max={100}
                            step={1}
                            onChange={(event) => setVolume(Number(event.target.value))}
                            icon={Volume2}
                          />
                        </div>
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>

              <AudioFormError message={generationError} />

              <button
                type="submit"
                disabled={generating}
                className="btn-primary inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl font-medium disabled:opacity-60"
              >
                {generating ? <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" /> : <WandSparkles className="h-5 w-5" />}
                {generating ? "正在生成语音…" : "生成语音"}
              </button>
              <div className="sr-only" aria-live="polite">
                {generating ? "正在生成语音，请稍候" : latestGeneration ? "语音已经生成并保存" : ""}
              </div>
            </form>
          </section>

          {generating ? (
            <AudioGeneratingBanner />
          ) : latestGeneration ? (
            <section className="space-y-3" aria-labelledby="latest-audio-title">
              <div>
                <h2 id="latest-audio-title" className="text-base font-semibold">本次结果</h2>
                <p className="mt-1 text-sm text-zinc-500">音频已经保存，可以直接播放或下载。</p>
              </div>
              <AudioGenerationCard
                generation={latestGeneration}
                featured
                deleting={deletingGenerationId === latestGeneration.id}
                deleteDisabled={Boolean(deletingGenerationId)}
                onDelete={setDeleteTarget}
              />
            </section>
          ) : null}

          <AudioHistorySection
            totalCount={generations.length}
            items={historyGenerations}
            loading={generationsLoading}
            error={generationsError}
            onRefresh={loadGenerations}
            emptyDescription="在上方输入文字并生成语音，结果会安全保存在这里。"
            renderItem={(generation) => (
              <AudioGenerationCard
                key={generation.id}
                generation={generation}
                deleting={deletingGenerationId === generation.id}
                deleteDisabled={Boolean(deletingGenerationId)}
                onDelete={setDeleteTarget}
              />
            )}
          />
        </div>
      ) : (
        <div id="audio-panel-cloning" role="tabpanel" aria-labelledby="audio-tab-cloning">
          <VoiceClonePanel
            voices={voices}
            loading={voicesLoading}
            error={voicesError}
            onCreate={handleCreateVoice}
            onRename={handleRenameVoice}
            onReplace={handleReplaceVoice}
            onDelete={handleDeleteVoice}
            onRefreshVoice={handleRefreshVoice}
            onRefreshList={loadVoices}
          />
        </div>
      )}

      <VoicePicker
        open={voicePickerOpen}
        brandLabel="Qwen Audio"
        selectedVoiceId={selectedVoice?.voiceId || ""}
        presetSection={{
          title: "推荐音色",
          description: "精选 10 个覆盖陪伴、播报、阅读与配音场景的音色。",
          voices: PRESET_VOICE_ITEMS,
        }}
        customSection={{
          title: "我的音色",
          description: "在“声音复刻”中创建的专属声音。",
          voices: voices.map(mapQwenCustomVoice),
          loading: voicesLoading,
          error: voicesError,
          emptyTitle: "还没有复刻音色",
          emptyDescription: "关闭面板后切换到“声音复刻”即可创建。",
        }}
        onClose={closeVoicePicker}
        onSelect={selectVoice}
        onRename={handleRenameVoice}
      />

      <MediaConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDeleteGeneration}
        title="删除语音记录"
        message="确定删除这条语音吗？音频文件也会一并删除，之后无法恢复。"
        confirmText="删除语音"
        danger
      />
    </div>
  );
}
