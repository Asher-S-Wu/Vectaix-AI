"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AudioLines,
  AudioWaveform,
  ChevronDown,
  Gauge,
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
import DoubaoAudioGenerationCard from "@/app/components/media/DoubaoAudioGenerationCard";
import DoubaoVoiceLibraryPanel from "@/app/components/media/DoubaoVoiceLibraryPanel";
import MediaConfirmDialog from "@/app/components/media/MediaConfirmDialog";
import MediaSelect from "@/app/components/media/MediaSelect";
import VoicePicker, { mapDoubaoCustomVoice } from "@/app/components/media/VoicePicker";
import { playNewGenerationOnce } from "@/lib/media/client/audioAutoPlay.mjs";
import { createDoubaoAudioVoicePageAdapter } from "@/lib/media/client/audioVoiceSelection.mjs";
import { readLocalSetting, writeLocalSetting } from "@/lib/client/localSettings";
import {
  createDoubaoAudioGeneration,
  createDoubaoVoice,
  deleteDoubaoAudioGeneration,
  deleteDoubaoVoice,
  listDoubaoAudioGenerations,
  listDoubaoVoices,
  renameDoubaoVoice,
} from "@/lib/media/client/media";
import {
  DOUBAO_AUDIO_DEFAULT_SAMPLE_RATE,
  DOUBAO_AUDIO_FORMAT_OPTIONS,
  DOUBAO_AUDIO_INSTRUCTION_MAX_LENGTH,
  DOUBAO_AUDIO_MODEL,
  DOUBAO_AUDIO_SAMPLE_RATE_OPTIONS,
  DOUBAO_AUDIO_TEXT_MAX_LENGTH,
} from "@/lib/media/shared/doubaoAudio";

function merge(items, item) {
  return [item, ...items.filter((current) => current.id !== item.id)].slice(0, 100);
}

function signedValue(value) {
  return value > 0 ? `+${value}` : String(value);
}

function sampleRateLabel(value) {
  return DOUBAO_AUDIO_SAMPLE_RATE_OPTIONS.find((option) => option.id === value).label;
}

export default function DoubaoAudioWorkspacePage() {
  const reduceMotion = useReducedMotion();
  const textRef = useRef(null);
  const generationsVersionRef = useRef(0);
  const pendingAutoPlayGenerationIdRef = useRef("");
  const [voiceSelectionController] = useState(() => createDoubaoAudioVoicePageAdapter({
    readSetting: readLocalSetting,
    writeSetting: writeLocalSetting,
  }));
  const [activeTab, setActiveTab] = useState("synthesis");
  const [text, setText] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [instruction, setInstruction] = useState("");
  const [format, setFormat] = useState("mp3");
  const [sampleRate, setSampleRate] = useState(DOUBAO_AUDIO_DEFAULT_SAMPLE_RATE);
  const [speechRate, setSpeechRate] = useState(0);
  const [loudnessRate, setLoudnessRate] = useState(0);
  const [pitchRate, setPitchRate] = useState(0);
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
  const [voices, setVoices] = useState([]);
  const [voicesLoading, setVoicesLoading] = useState(true);
  const [voicesError, setVoicesError] = useState("");

  const selectVoiceId = useCallback((nextVoiceId) => {
    setVoiceId(voiceSelectionController.select(nextVoiceId));
  }, [voiceSelectionController]);

  const latestAudioRef = useCallback((audioElement) => playNewGenerationOnce({
    generationId: latestId,
    pendingGenerationIdRef: pendingAutoPlayGenerationIdRef,
    audioElement,
  }), [latestId]);

  const loadGenerations = useCallback(async () => {
    const version = ++generationsVersionRef.current;
    setGenerationsLoading(true);
    setGenerationsError("");
    try {
      const nextGenerations = await listDoubaoAudioGenerations();
      if (generationsVersionRef.current !== version) return;
      setGenerations(nextGenerations);
    } catch (error) {
      if (generationsVersionRef.current !== version) return;
      setGenerationsError(error instanceof Error ? error.message : "读取豆包语音记录失败");
    } finally {
      if (generationsVersionRef.current === version) setGenerationsLoading(false);
    }
  }, []);

  const loadVoices = useCallback(async () => {
    const load = voiceSelectionController.beginLoad();
    setVoicesLoading(true);
    setVoicesError("");
    try {
      const nextVoices = await listDoubaoVoices();
      const selection = voiceSelectionController.resolveLoadedVoice(load, {
        availableVoiceIds: nextVoices.map((voice) => voice.voiceId),
        defaultVoiceId: nextVoices[0]?.voiceId || "",
      });
      if (!selection.applied) return;
      setVoices(nextVoices);
      setVoiceId(selection.voiceId);
    } catch (error) {
      if (voiceSelectionController.canApplyLoad(load)) {
        setVoicesError(error instanceof Error ? error.message : "读取豆包声音失败");
      }
    } finally {
      if (voiceSelectionController.finishLoad(load)) setVoicesLoading(false);
    }
  }, [voiceSelectionController]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadGenerations();
      loadVoices();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadGenerations, loadVoices]);

  const selectedVoice = useMemo(
    () => voices.find((voice) => voice.voiceId === voiceId) || null,
    [voiceId, voices],
  );
  const latest = generations.find((item) => item.id === latestId) || null;
  const history = latest ? generations.filter((item) => item.id !== latest.id) : generations;

  const closeVoicePicker = useCallback(() => setVoicePickerOpen(false), []);
  const selectVoice = useCallback((voice) => {
    selectVoiceId(voice.voiceId);
    setGenerationError("");
  }, [selectVoiceId]);

  const handleGenerate = useCallback(async (event) => {
    event.preventDefault();
    const normalizedText = text.trim();
    const normalizedInstruction = instruction.trim();
    setGenerationError("");
    if (!normalizedText) {
      setGenerationError("请输入需要合成的文字");
      textRef.current?.focus();
      return;
    }
    if (normalizedText.length > DOUBAO_AUDIO_TEXT_MAX_LENGTH) {
      setGenerationError(`合成文本最多支持 ${DOUBAO_AUDIO_TEXT_MAX_LENGTH.toLocaleString("zh-CN")} 个字符`);
      return;
    }
    if (!voiceId || !selectedVoice) {
      setGenerationError("请先从声音库选择一个声音");
      return;
    }
    if (normalizedInstruction.length > DOUBAO_AUDIO_INSTRUCTION_MAX_LENGTH) {
      setGenerationError(`表达要求最多支持 ${DOUBAO_AUDIO_INSTRUCTION_MAX_LENGTH} 个字符`);
      return;
    }

    setGenerating(true);
    try {
      const generation = await createDoubaoAudioGeneration({
        text: normalizedText,
        voiceId,
        instruction: normalizedInstruction,
        format,
        sampleRate,
        speechRate,
        loudnessRate,
        pitchRate,
      });
      generationsVersionRef.current += 1;
      pendingAutoPlayGenerationIdRef.current = generation.id;
      setGenerations((current) => merge(current, generation));
      setLatestId(generation.id);
      setGenerationsError("");
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "豆包语音生成失败");
    } finally {
      setGenerating(false);
    }
  }, [format, instruction, loudnessRate, pitchRate, sampleRate, selectedVoice, speechRate, text, voiceId]);

  const confirmDeleteGeneration = useCallback(async () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    setDeletingId(target.id);
    setGenerationsError("");
    try {
      await deleteDoubaoAudioGeneration(target.generationId);
      generationsVersionRef.current += 1;
      setGenerations((current) => current.filter((item) => item.id !== target.id));
      setLatestId((current) => current === target.id ? "" : current);
    } catch (error) {
      setGenerationsError(error instanceof Error ? error.message : "删除豆包语音记录失败");
    } finally {
      setDeletingId("");
    }
  }, [deleteTarget]);

  const handleCreateVoice = useCallback(async (input) => {
    if (voiceSelectionController.isLoading()) {
      throw new Error("声音列表正在读取，请稍后再保存");
    }
    const voice = await createDoubaoVoice(input);
    voiceSelectionController.markMutation();
    setVoices((current) => merge(current, voice));
    selectVoiceId(voice.voiceId);
    setVoicesError("");
    return voice;
  }, [selectVoiceId, voiceSelectionController]);

  const handleRenameVoice = useCallback(async (voice, displayName) => {
    const updated = await renameDoubaoVoice(voice.profileId, displayName);
    voiceSelectionController.markMutation();
    setVoices((current) => current.map((item) => item.profileId === updated.profileId ? updated : item));
    setVoicesError("");
    return updated;
  }, [voiceSelectionController]);

  const handleDeleteVoice = useCallback(async (voice) => {
    await deleteDoubaoVoice(voice.profileId);
    voiceSelectionController.markMutation();
    setVoices((current) => current.filter((item) => item.profileId !== voice.profileId));
    const previousVoiceId = voiceSelectionController.getVoiceId();
    const nextVoiceId = voiceSelectionController.resolveAfterDelete({
      deletedVoiceId: voice.voiceId,
      defaultVoiceId: "",
    });
    if (nextVoiceId !== previousVoiceId) setVoiceId(nextVoiceId);
    setVoicesError("");
  }, [voiceSelectionController]);

  return (
    <div className="space-y-6">
      <AudioWorkspaceHero
        icon={AudioWaveform}
        title="豆包语音工作台"
        badge="Seed Audio 1.0"
        description="使用声音库中的参考声音，把文字生成自然、清晰、富有表现力的语音。"
        modelLabel={DOUBAO_AUDIO_MODEL}
      >
        <AudioWorkspaceTabs
          idPrefix="doubao-audio"
          tabs={[
            { id: "synthesis", label: "语音合成", icon: WandSparkles },
            { id: "library", label: "声音库", icon: Mic2 },
          ]}
          activeTab={activeTab}
          onChange={setActiveTab}
          ariaLabel="豆包语音功能"
        />
      </AudioWorkspaceHero>

      {activeTab === "synthesis" ? (
        <div id="doubao-audio-panel-synthesis" role="tabpanel" aria-labelledby="doubao-audio-tab-synthesis" className="space-y-6">
          <section className="glass-effect rounded-2xl border border-zinc-200/60 p-5 dark:border-zinc-800/60 sm:p-6">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">创作语音</h2>
                <p className="mt-1 text-sm text-zinc-500">输入内容、选择声音，再按需要调整表达方式与声音参数。</p>
              </div>
              <span className="hidden items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1.5 text-xs text-zinc-500 dark:bg-zinc-800 sm:inline-flex">
                <Sparkles className="h-3.5 w-3.5 text-primary" />{DOUBAO_AUDIO_MODEL}
              </span>
            </div>

            <form onSubmit={handleGenerate} className="space-y-5">
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
                <div className="space-y-2">
                  <div className="flex items-end justify-between gap-3">
                    <label htmlFor="doubao-text" className="text-sm font-medium">合成文本</label>
                    <span className={`text-xs ${text.length >= DOUBAO_AUDIO_TEXT_MAX_LENGTH ? "text-red-600" : "text-zinc-500"}`}>
                      {text.length.toLocaleString("zh-CN")} / {DOUBAO_AUDIO_TEXT_MAX_LENGTH.toLocaleString("zh-CN")}
                    </span>
                  </div>
                  <textarea
                    ref={textRef}
                    id="doubao-text"
                    value={text}
                    onChange={(event) => {
                      setText(event.target.value);
                      setGenerationError("");
                    }}
                    maxLength={DOUBAO_AUDIO_TEXT_MAX_LENGTH}
                    placeholder="输入想让声音朗读的内容。"
                    className="focus-ring min-h-[260px] w-full resize-y rounded-2xl border border-zinc-200 bg-white px-4 py-4 text-sm leading-7 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </div>

                <div className="space-y-5">
                  <div className="space-y-2">
                    <span className="text-sm font-medium">声音</span>
                    <button
                      type="button"
                      onClick={() => setVoicePickerOpen(true)}
                      className="group flex min-h-[112px] w-full items-center gap-3 rounded-2xl border border-zinc-200 bg-white/70 p-4 text-left transition-[border-color,background-color,transform] hover:border-primary/50 hover:bg-primary/[0.03] active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900/70"
                      aria-haspopup="dialog"
                    >
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Mic2 className="h-5 w-5" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                          {voicesLoading ? "正在读取声音…" : selectedVoice?.displayName || "请选择声音"}
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-zinc-500">
                          {selectedVoice ? `我的参考声音 · ${Number(selectedVoice.duration).toFixed(1)} 秒 · ${sampleRateLabel(selectedVoice.sampleRate)}` : "请先在声音库添加并选择参考声音"}
                        </span>
                      </span>
                      <ChevronDown className="-rotate-90 h-4 w-4 shrink-0 text-zinc-400 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
                    </button>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-end justify-between gap-3">
                      <label htmlFor="doubao-instruction" className="text-sm font-medium">表达要求</label>
                      <span className="text-xs text-zinc-400">{instruction.length}/{DOUBAO_AUDIO_INSTRUCTION_MAX_LENGTH}</span>
                    </div>
                    <textarea
                      id="doubao-instruction"
                      value={instruction}
                      onChange={(event) => {
                        setInstruction(event.target.value);
                        setGenerationError("");
                      }}
                      maxLength={DOUBAO_AUDIO_INSTRUCTION_MAX_LENGTH}
                      rows={4}
                      placeholder="例如：语气温柔自然，稍微放慢节奏。"
                      className="focus-ring min-h-[112px] w-full resize-y rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm leading-6 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900"
                    />
                  </div>
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
                  <span className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-primary" />声音设置</span>
                  <span className="flex items-center gap-2 text-xs font-normal text-zinc-500">
                    {format.toUpperCase()} · {sampleRateLabel(sampleRate)}
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
                            <label htmlFor="doubao-format" className="text-xs font-medium text-zinc-600 dark:text-zinc-300">音频格式</label>
                            <MediaSelect id="doubao-format" ariaLabel="音频格式" value={format} onChange={setFormat} disabled={generating} options={DOUBAO_AUDIO_FORMAT_OPTIONS} />
                          </div>
                          <div className="space-y-2">
                            <label htmlFor="doubao-sample-rate" className="text-xs font-medium text-zinc-600 dark:text-zinc-300">采样率</label>
                            <MediaSelect id="doubao-sample-rate" ariaLabel="采样率" value={sampleRate} onChange={setSampleRate} disabled={generating} options={DOUBAO_AUDIO_SAMPLE_RATE_OPTIONS} />
                          </div>
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                          <AudioSliderField id="doubao-speech-rate" label="语速" valueLabel={signedValue(speechRate)} icon={Gauge} min={-50} max={100} step={1} value={speechRate} onChange={(event) => setSpeechRate(Number(event.target.value))} disabled={generating} />
                          <AudioSliderField id="doubao-loudness-rate" label="音量" valueLabel={signedValue(loudnessRate)} icon={Volume2} min={-50} max={100} step={1} value={loudnessRate} onChange={(event) => setLoudnessRate(Number(event.target.value))} disabled={generating} />
                          <AudioSliderField id="doubao-pitch-rate" label="音调" valueLabel={signedValue(pitchRate)} icon={AudioLines} min={-12} max={12} step={1} value={pitchRate} onChange={(event) => setPitchRate(Number(event.target.value))} disabled={generating} />
                        </div>
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>

              <AudioFormError message={generationError || voicesError} />
              <button
                type="submit"
                disabled={generating || voicesLoading || !selectedVoice}
                className="btn-primary inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl font-medium disabled:opacity-60"
              >
                {generating ? <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" /> : <WandSparkles className="h-5 w-5" />}
                {generating ? "正在生成语音…" : (voices.length ? "生成语音" : "请先添加声音")}
              </button>
              <div className="sr-only" aria-live="polite">{generating ? "正在生成语音，请稍候" : latest ? "语音已经生成并保存" : ""}</div>
            </form>
          </section>

          {generating ? (
            <AudioGeneratingBanner />
          ) : latest ? (
            <section className="space-y-3" aria-labelledby="latest-doubao-audio-title">
              <div>
                <h2 id="latest-doubao-audio-title" className="text-base font-semibold">本次结果</h2>
                <p className="mt-1 text-sm text-zinc-500">音频已经保存，可以直接播放或下载。</p>
              </div>
              <DoubaoAudioGenerationCard generation={latest} featured audioRef={latestAudioRef} deleting={deletingId === latest.id} deleteDisabled={Boolean(deletingId)} onDelete={setDeleteTarget} />
            </section>
          ) : null}

          <AudioHistorySection
            totalCount={generations.length}
            items={history}
            loading={generationsLoading}
            error={generationsError}
            onRefresh={loadGenerations}
            renderItem={(generation) => (
              <DoubaoAudioGenerationCard key={generation.id} generation={generation} deleting={deletingId === generation.id} deleteDisabled={Boolean(deletingId)} onDelete={setDeleteTarget} />
            )}
          />
        </div>
      ) : (
        <div id="doubao-audio-panel-library" role="tabpanel" aria-labelledby="doubao-audio-tab-library">
          <DoubaoVoiceLibraryPanel
            voices={voices}
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
        brandLabel="Seed Audio 1.0"
        title="选择声音"
        description="从声音库中选择这次合成要使用的参考声音。"
        selectedVoiceId={voiceId}
        customSection={{
          title: "我的声音",
          description: "已保存在声音库中的参考声音。",
          voices: voices.map(mapDoubaoCustomVoice),
          loading: voicesLoading,
          error: voicesError,
          emptyTitle: "还没有参考声音",
          emptyDescription: "关闭窗口后切换到“声音库”即可添加。",
        }}
        onClose={closeVoicePicker}
        onSelect={selectVoice}
        onRename={handleRenameVoice}
        renameMaxLength={40}
      />

      <MediaConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除语音记录"
        message="确定删除这条豆包语音吗？对应音频文件也会一起删除，无法恢复。"
        confirmText="删除语音"
        danger
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDeleteGeneration}
      />
    </div>
  );
}
