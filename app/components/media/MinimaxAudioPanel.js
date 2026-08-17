"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AudioLines,
  ChevronDown,
  CircleAlert,
  Gauge,
  History,
  Languages,
  Loader2,
  Mic2,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Volume2,
  WandSparkles,
} from "lucide-react";
import MediaConfirmDialog from "@/app/components/media/MediaConfirmDialog";
import MinimaxAudioGenerationCard from "@/app/components/media/MinimaxAudioGenerationCard";
import MinimaxVoiceClonePanel from "@/app/components/media/MinimaxVoiceClonePanel";
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

function SliderField({ id, label, valueLabel, icon: Icon, ...props }) {
  return (
    <label htmlFor={id} className="space-y-2 rounded-xl border border-zinc-200 bg-white/60 p-3 dark:border-zinc-800 dark:bg-zinc-950/40">
      <span className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300"><Icon className="h-3.5 w-3.5 text-primary" />{label}</span>
        <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">{valueLabel}</span>
      </span>
      <input id={id} type="range" className="h-2 w-full cursor-pointer accent-primary" {...props} />
    </label>
  );
}

function HistorySkeleton() {
  return (
    <div className="space-y-2" aria-label="正在读取 MiniMax 语音记录" aria-busy="true">
      {[0, 1, 2].map((item) => (
        <div key={item} className="h-28 animate-pulse rounded-2xl border border-zinc-200 bg-zinc-100/60 motion-reduce:animate-none dark:border-zinc-800 dark:bg-zinc-900/60" />
      ))}
    </div>
  );
}

export default function MinimaxAudioPanel() {
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
  const [settingsOpen, setSettingsOpen] = useState(true);
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

  const insertTag = (tag) => {
    const textarea = textRef.current;
    const start = textarea?.selectionStart ?? text.length;
    const end = textarea?.selectionEnd ?? start;
    const next = `${text.slice(0, start)}${tag}${text.slice(end)}`;
    if (next.length > MINIMAX_AUDIO_TEXT_MAX_LENGTH) {
      setGenerationError(`朗读文字最多支持 ${MINIMAX_AUDIO_TEXT_MAX_LENGTH} 个字符`);
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
    if (!normalized) return setGenerationError("请输入需要朗读的文字");
    if (normalized.length > MINIMAX_AUDIO_TEXT_MAX_LENGTH) {
      return setGenerationError(`朗读文字最多支持 ${MINIMAX_AUDIO_TEXT_MAX_LENGTH} 个字符`);
    }
    if (!voiceId) return setGenerationError("请选择一个音色");
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

  const onTabKeyDown = (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = Array.from(event.currentTarget.querySelectorAll('[role="tab"]'));
    const current = tabs.indexOf(event.target.closest('[role="tab"]'));
    if (current < 0) return;
    event.preventDefault();
    let next = current;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
    setActiveTab(tabs[next].dataset.tabId);
    tabs[next].focus();
  };

  return (
    <section className="glass-effect overflow-hidden rounded-[28px] border border-zinc-200/60 dark:border-zinc-800/60">
      <div className="border-b border-zinc-200/60 p-3 dark:border-zinc-800/60 sm:p-4">
        <div className="grid grid-cols-2 gap-2 rounded-2xl border border-zinc-200 bg-zinc-100/70 p-1 dark:border-zinc-800 dark:bg-zinc-900/70" role="tablist" aria-label="MiniMax 语音功能" onKeyDown={onTabKeyDown}>
          {[
            { id: "synthesis", label: "语音合成", icon: WandSparkles },
            { id: "cloning", label: "声音复刻", icon: Mic2 },
          ].map((tab) => {
            const active = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-tab-id={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`focus-ring flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition-colors ${active ? "bg-white text-primary shadow-sm dark:bg-zinc-800" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}
              >
                <Icon className="h-4 w-4" />{tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {activeTab === "synthesis" ? (
          <motion.div key="synthesis" initial={reduceMotion ? false : { opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="space-y-6 p-4 sm:p-6">
            <form onSubmit={handleGenerate} className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">生成模型</span>
                  <select value={model} onChange={(event) => setModel(event.target.value)} disabled={generating} className="focus-ring h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900">
                    {MINIMAX_AUDIO_MODELS.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.price}</option>)}
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="flex items-center justify-between gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">
                    朗读音色
                    <button type="button" onClick={loadVoices} disabled={voicesLoading || generating} className="focus-ring rounded-lg p-1 text-zinc-400 hover:text-primary" aria-label="刷新音色"><RefreshCw className={`h-3.5 w-3.5 ${voicesLoading ? "animate-spin" : ""}`} /></button>
                  </span>
                  <select value={voiceId} onChange={(event) => setVoiceId(event.target.value)} disabled={voicesLoading || generating || !allVoices.length} className="focus-ring h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900">
                    {!allVoices.length ? <option value="">暂无可用音色</option> : null}
                    {systemVoices.length ? <optgroup label="系统音色">{systemVoices.map((voice) => <option key={voice.voiceId} value={voice.voiceId}>{voice.name}</option>)}</optgroup> : null}
                    {customVoices.length ? <optgroup label="我的复刻音色">{customVoices.map((voice) => <option key={voice.voiceId} value={voice.voiceId}>{voice.displayName}</option>)}</optgroup> : null}
                  </select>
                </label>
              </div>

              {selectedVoice ? (
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  <span className="rounded-full bg-primary/10 px-2 py-1 font-medium text-primary">{selectedVoice.kind === "custom" ? "我的复刻音色" : "系统音色"}</span>
                  {Array.isArray(selectedVoice.description) ? selectedVoice.description.slice(0, 3).map((item) => <span key={item}>{item}</span>) : null}
                </div>
              ) : null}

              <label className="block space-y-2">
                <span className="flex items-center justify-between gap-3 text-sm font-medium text-zinc-700 dark:text-zinc-200">
                  朗读文字
                  <span className={`text-xs font-normal ${text.length > MINIMAX_AUDIO_TEXT_MAX_LENGTH ? "text-red-500" : "text-zinc-400"}`}>{text.length.toLocaleString("zh-CN")}/{MINIMAX_AUDIO_TEXT_MAX_LENGTH.toLocaleString("zh-CN")}</span>
                </span>
                <textarea ref={textRef} value={text} onChange={(event) => { setText(event.target.value); setGenerationError(""); }} maxLength={MINIMAX_AUDIO_TEXT_MAX_LENGTH} rows={7} disabled={generating} placeholder="输入需要转换成语音的文字…" className="focus-ring w-full resize-y rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm leading-7 dark:border-zinc-700 dark:bg-zinc-900" />
              </label>

              <div className="space-y-2">
                <p className="text-xs font-medium text-zinc-500">插入自然语气</p>
                <div className="flex flex-wrap gap-2">
                  {MINIMAX_EXPRESSIVE_TAGS.map((tag) => (
                    <button key={tag.value} type="button" onClick={() => insertTag(tag.value)} disabled={generating} className="focus-ring rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-600 hover:border-primary/40 hover:text-primary dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">{tag.label}</button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800">
                <button type="button" onClick={() => setSettingsOpen((value) => !value)} className="focus-ring flex min-h-12 w-full items-center justify-between gap-3 px-4 text-sm font-semibold">
                  <span className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-primary" />声音设置</span>
                  <ChevronDown className={`h-4 w-4 text-zinc-400 transition-transform ${settingsOpen ? "rotate-180" : ""}`} />
                </button>
                {settingsOpen ? (
                  <div className="grid gap-3 border-t border-zinc-200 p-3 dark:border-zinc-800 sm:grid-cols-2 lg:grid-cols-3">
                    <label className="space-y-2 rounded-xl border border-zinc-200 bg-white/60 p-3 dark:border-zinc-800 dark:bg-zinc-950/40">
                      <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300"><Sparkles className="h-3.5 w-3.5 text-primary" />情感</span>
                      <select value={emotion} onChange={(event) => setEmotion(event.target.value)} disabled={generating} className="focus-ring h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">{MINIMAX_AUDIO_EMOTION_OPTIONS.map((item) => <option key={item.id || "auto"} value={item.id}>{item.label}</option>)}</select>
                    </label>
                    <label className="space-y-2 rounded-xl border border-zinc-200 bg-white/60 p-3 dark:border-zinc-800 dark:bg-zinc-950/40">
                      <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300"><Languages className="h-3.5 w-3.5 text-primary" />语言增强</span>
                      <select value={languageBoost} onChange={(event) => setLanguageBoost(event.target.value)} disabled={generating} className="focus-ring h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">{MINIMAX_AUDIO_LANGUAGE_OPTIONS.map((item) => <option key={item.id || "none"} value={item.id}>{item.label}</option>)}</select>
                    </label>
                    <div className="grid grid-cols-2 gap-2 rounded-xl border border-zinc-200 bg-white/60 p-3 dark:border-zinc-800 dark:bg-zinc-950/40">
                      <label className="space-y-2"><span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">格式</span><select value={format} onChange={(event) => setFormat(event.target.value)} disabled={generating} className="focus-ring h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">{MINIMAX_AUDIO_FORMAT_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                      <label className="space-y-2"><span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">采样率</span><select value={sampleRate} onChange={(event) => setSampleRate(Number(event.target.value))} disabled={generating} className="focus-ring h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">{MINIMAX_AUDIO_SAMPLE_RATE_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                    </div>
                    <SliderField id="minimax-speed" label="语速" valueLabel={`${speed.toFixed(1)}×`} icon={Gauge} min="0.5" max="2" step="0.1" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} disabled={generating} />
                    <SliderField id="minimax-volume" label="音量" valueLabel={volume.toFixed(1)} icon={Volume2} min="0.1" max="10" step="0.1" value={volume} onChange={(event) => setVolume(Number(event.target.value))} disabled={generating} />
                    <SliderField id="minimax-pitch" label="音高" valueLabel={`${pitch > 0 ? "+" : ""}${pitch}`} icon={AudioLines} min="-12" max="12" step="1" value={pitch} onChange={(event) => setPitch(Number(event.target.value))} disabled={generating} />
                  </div>
                ) : null}
              </div>

              {generationError || voicesError ? (
                <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>{generationError || voicesError}</span></div>
              ) : null}

              <button type="submit" disabled={generating || voicesLoading || !voiceId} className="focus-ring inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}
                {generating ? "正在生成并保存语音…" : "生成 MiniMax 语音"}
              </button>
            </form>

            {latest ? (
              <section className="space-y-3 border-t border-zinc-200/70 pt-5 dark:border-zinc-800/70">
                <div><h2 className="text-base font-semibold">本次结果</h2><p className="mt-1 text-sm text-zinc-500">音频已经保存，可以直接播放或下载。</p></div>
                <MinimaxAudioGenerationCard generation={latest} featured deleting={deletingId === latest.id} deleteDisabled={Boolean(deletingId)} onDelete={setDeleteTarget} />
              </section>
            ) : null}

            <section className="space-y-3 border-t border-zinc-200/70 pt-5 dark:border-zinc-800/70">
              <div className="flex items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-base font-semibold"><History className="h-4 w-4 text-primary" />生成历史</h2><p className="mt-1 text-sm text-zinc-500">最多保留最近 100 条 MiniMax 语音。</p></div><button type="button" onClick={loadGenerations} disabled={generationsLoading} className="focus-ring rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 hover:text-primary dark:hover:bg-zinc-800" aria-label="刷新生成历史"><RefreshCw className={`h-4 w-4 ${generationsLoading ? "animate-spin" : ""}`} /></button></div>
              {generationsError ? <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{generationsError}</div> : null}
              {generationsLoading ? <HistorySkeleton /> : !generations.length ? <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 px-6 text-center dark:border-zinc-700"><AudioLines className="h-7 w-7 text-primary" /><p className="mt-3 text-sm font-medium">还没有 MiniMax 语音记录</p><p className="mt-1 text-xs text-zinc-500">完成首次生成后，结果会安全保存在这里。</p></div> : !history.length ? <p className="py-6 text-center text-sm text-zinc-500">当前只有上方这条新记录。</p> : <div className="fade-scrollbar max-h-[620px] space-y-3 overflow-y-auto pr-1"><AnimatePresence initial={false}>{history.map((generation) => <MinimaxAudioGenerationCard key={generation.id} generation={generation} deleting={deletingId === generation.id} deleteDisabled={Boolean(deletingId)} onDelete={setDeleteTarget} />)}</AnimatePresence></div>}
            </section>
          </motion.div>
        ) : (
          <motion.div key="cloning" initial={reduceMotion ? false : { opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="p-4 sm:p-6">
            <MinimaxVoiceClonePanel voices={customVoices} loading={voicesLoading} error={voicesError} onCreate={handleCreateVoice} onRename={handleRenameVoice} onDelete={handleDeleteVoice} onRefresh={loadVoices} />
          </motion.div>
        )}
      </AnimatePresence>

      <MediaConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除语音记录"
        message="确定删除这条 MiniMax 语音吗？对应音频文件也会一起删除，无法恢复。"
        confirmText="删除"
        danger
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDeleteGeneration}
      />
    </section>
  );
}
