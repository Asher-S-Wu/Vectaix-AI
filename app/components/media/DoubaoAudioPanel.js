"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AudioLines,
  Captions,
  ChevronDown,
  CircleAlert,
  FileAudio2,
  History,
  Loader2,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  WandSparkles,
  Waves,
} from "lucide-react";
import DoubaoAudioGenerationCard from "@/app/components/media/DoubaoAudioGenerationCard";
import MediaConfirmDialog from "@/app/components/media/MediaConfirmDialog";
import {
  createDoubaoAudioGeneration,
  deleteDoubaoAudioGeneration,
  listDoubaoAudioGenerations,
} from "@/lib/media/client/media";
import {
  DOUBAO_AUDIO_FORMAT_OPTIONS,
  DOUBAO_AUDIO_MODES,
  DOUBAO_AUDIO_REFERENCE_MAX_BYTES,
  DOUBAO_AUDIO_REFERENCE_MAX_COUNT,
  DOUBAO_AUDIO_REFERENCE_MAX_DURATION_SECONDS,
  DOUBAO_AUDIO_TEXT_MAX_LENGTH,
} from "@/lib/media/shared/doubaoAudio";

const AUDIO_ACCEPT = ".mp3,.wav,.ogg,audio/mpeg,audio/wav,audio/ogg";

function mergeGeneration(items, nextGeneration) {
  return [nextGeneration, ...items.filter((item) => item.id !== nextGeneration.id)].slice(0, 100);
}

function fileExtension(name) {
  const match = /\.([^.]+)$/.exec(String(name || "").toLowerCase());
  return match ? match[1] : "";
}

function inspectAudioDuration(file) {
  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio");
    const url = URL.createObjectURL(file);
    const cleanup = () => {
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const duration = audio.duration;
      cleanup();
      if (!Number.isFinite(duration) || duration <= 0) {
        reject(new Error(`无法读取 ${file.name} 的音频时长`));
        return;
      }
      if (duration > DOUBAO_AUDIO_REFERENCE_MAX_DURATION_SECONDS) {
        reject(new Error(`${file.name} 超过 30 秒`));
        return;
      }
      resolve(Math.round(duration * 10) / 10);
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error(`${file.name} 不是可读取的 MP3、WAV 或 OGG Opus 音频`));
    };
    audio.src = url;
  });
}

function useObjectUrl(file) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file) return undefined;
    const nextUrl = URL.createObjectURL(file);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);
  return url;
}

function SliderField({ id, label, value, min, max, icon: Icon, onChange }) {
  return (
    <div className="space-y-2 rounded-xl border border-zinc-200 bg-white/60 p-3 dark:border-zinc-800 dark:bg-zinc-950/40">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300"><Icon className="h-3.5 w-3.5 text-primary" />{label}</label>
        <output htmlFor={id} className="text-xs font-semibold tabular-nums text-zinc-700 dark:text-zinc-200">{value}</output>
      </div>
      <input id={id} type="range" min={min} max={max} step={1} value={value} onChange={(event) => onChange(Number(event.target.value))} className="h-2 w-full cursor-pointer accent-primary" />
    </div>
  );
}

function AudioReferenceItem({ item, index, onRemove }) {
  const url = useObjectUrl(item.file);
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><FileAudio2 className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-200">@音频{index + 1} · {item.file.name}</p>
          <p className="mt-0.5 text-[11px] text-zinc-400">{item.duration.toFixed(1)} 秒 · {(item.file.size / 1024 / 1024).toFixed(1)} MB</p>
        </div>
        <button type="button" onClick={() => onRemove(index)} aria-label={`移除 @音频${index + 1}`} className="rounded-lg p-2 text-zinc-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
      </div>
      {url ? <audio controls preload="metadata" src={url} className="mt-2 h-9 w-full" /> : null}
    </div>
  );
}

function HistorySkeleton() {
  return <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((item) => <div key={item} className="h-16 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />)}</div>;
}

export default function DoubaoAudioPanel() {
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

  useEffect(() => { loadGenerations(); }, [loadGenerations]);

  const changeMode = (nextMode) => {
    setMode(nextMode);
    setAudioReferences([]);
    setGenerationError("");
    if (audioInputRef.current) audioInputRef.current.value = "";
  };

  const addAudioReferences = async (files) => {
    const incoming = Array.from(files || []);
    if (!incoming.length) return;
    if (audioReferences.length + incoming.length > DOUBAO_AUDIO_REFERENCE_MAX_COUNT) {
      setGenerationError("最多只能上传 3 段参考音频");
      return;
    }
    const next = [];
    try {
      for (const file of incoming) {
        if (!["mp3", "wav", "ogg"].includes(fileExtension(file.name))) throw new Error(`${file.name} 的格式不受支持`);
        if (file.size <= 0 || file.size > DOUBAO_AUDIO_REFERENCE_MAX_BYTES) throw new Error(`${file.name} 不能超过 10MB`);
        next.push({ file, duration: await inspectAudioDuration(file) });
      }
      setAudioReferences((current) => [...current, ...next]);
      setGenerationError("");
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "参考音频无法读取");
    }
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
        audioReferences,
        format,
        speechRate,
        enableSubtitle,
      });
      setGenerations((current) => mergeGeneration(current, generation));
      setLatestGenerationId(generation.id);
      setGenerationsError("");
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "Doubao 音频生成失败");
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
      <section className="glass-effect rounded-2xl border border-zinc-200/60 p-5 dark:border-zinc-800/60 sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div><h2 className="text-lg font-semibold">创作音频</h2><p className="mt-1 text-sm text-zinc-500">用文字描述音效、配音或场景，也可以加入参考音频。</p></div>
          <span className="hidden rounded-full bg-zinc-100 px-3 py-1.5 text-xs text-zinc-500 dark:bg-zinc-800 sm:inline-flex">最长 120 秒</span>
        </div>

        <form onSubmit={handleGenerate} className="space-y-5">
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900" aria-label="Doubao 音频生成方式">
            {DOUBAO_AUDIO_MODES.map((item) => {
              const active = mode === item.id;
              const Icon = item.id === "text" ? Sparkles : FileAudio2;
              return <button key={item.id} type="button" onClick={() => changeMode(item.id)} className={`relative flex h-10 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold sm:text-sm ${active ? "bg-white text-zinc-800 shadow-sm dark:bg-zinc-800 dark:text-zinc-100" : "text-zinc-500"}`}><Icon className="h-4 w-4" />{item.label}</button>;
            })}
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
            <div className="space-y-3">
              <div className="flex items-end justify-between gap-3">
                <label htmlFor="doubao-audio-prompt" className="text-sm font-medium">音频描述或文本</label>
                <span className="text-xs text-zinc-400">{textPrompt.length}/{DOUBAO_AUDIO_TEXT_MAX_LENGTH}</span>
              </div>
              <textarea ref={textAreaRef} id="doubao-audio-prompt" value={textPrompt} maxLength={DOUBAO_AUDIO_TEXT_MAX_LENGTH} onChange={(event) => { setTextPrompt(event.target.value); setGenerationError(""); }} placeholder={mode === "audio-reference" ? "例如：使用 @音频1 的音色朗读这段旁白，前 2 秒加入雨声。" : "例如：生成 15 秒的雨夜街道环境音，远处偶尔传来汽车声。"} className="focus-ring min-h-[240px] w-full resize-y rounded-2xl border border-zinc-200 bg-white px-4 py-4 text-sm leading-7 dark:border-zinc-700 dark:bg-zinc-900" />
              {mode === "audio-reference" && audioReferences.length ? (
                <div className="flex flex-wrap gap-2">
                  {audioReferences.map((_, index) => <button key={index} type="button" onClick={() => insertAudioTag(index)} className="h-8 rounded-lg border border-zinc-200 bg-white px-2.5 text-xs font-medium text-primary dark:border-zinc-700 dark:bg-zinc-900">插入 @音频{index + 1}</button>)}
                </div>
              ) : null}
            </div>

            <div className="space-y-3">
              {mode === "text" ? (
                <div className="flex min-h-[240px] flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/70 px-5 text-center dark:border-zinc-800 dark:bg-zinc-900/40"><Waves className="h-8 w-8 text-primary" /><p className="mt-3 text-sm font-medium">无需参考素材</p><p className="mt-1 text-xs leading-5 text-zinc-500">直接描述声音、时长、情绪和时间轴即可。</p></div>
              ) : (
                <div className="space-y-2">
                  {audioReferences.map((item, index) => <AudioReferenceItem key={`${item.file.name}-${item.file.lastModified}-${index}`} item={item} index={index} onRemove={removeAudioReference} />)}
                  {audioReferences.length < DOUBAO_AUDIO_REFERENCE_MAX_COUNT ? <button type="button" onClick={() => audioInputRef.current?.click()} className="flex min-h-24 w-full flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 text-sm text-zinc-500 hover:border-primary hover:text-primary dark:border-zinc-700"><Upload className="mb-2 h-5 w-5" />上传参考音频<span className="mt-1 text-[11px] text-zinc-400">MP3 / WAV / OGG，单个不超过 30 秒、10MB</span></button> : null}
                  <input ref={audioInputRef} type="file" accept={AUDIO_ACCEPT} multiple className="sr-only" onChange={(event) => { addAudioReferences(event.target.files); event.target.value = ""; }} />
                </div>
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
            <button type="button" onClick={() => setAdvancedOpen((current) => !current)} aria-expanded={advancedOpen} className="flex h-12 w-full items-center justify-between px-4 text-sm font-medium text-zinc-700 dark:text-zinc-200"><span className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-primary" />音频设置</span><span className="flex items-center gap-2 text-xs font-normal text-zinc-500">{format.toUpperCase()}<ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`} /></span></button>
            <AnimatePresence initial={false}>{advancedOpen ? (
              <motion.div initial={reduceMotion ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="border-t border-zinc-200 bg-zinc-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="space-y-2 text-xs font-medium text-zinc-600 dark:text-zinc-300">输出格式<select value={format} onChange={(event) => setFormat(event.target.value)} className="focus-ring h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900">{DOUBAO_AUDIO_FORMAT_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                    <SliderField id="doubao-speech-rate" label="语速" value={speechRate} min={-50} max={100} icon={AudioLines} onChange={setSpeechRate} />
                  </div>
                  <label className="mt-4 flex cursor-pointer items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-3 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"><input type="checkbox" checked={enableSubtitle} onChange={(event) => setEnableSubtitle(event.target.checked)} className="h-4 w-4 accent-primary" /><Captions className="h-4 w-4 text-primary" />生成字幕</label>
                </div>
              </motion.div>
            ) : null}</AnimatePresence>
          </div>

          {generationError ? <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600" role="alert"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{generationError}</div> : null}
          <button type="submit" disabled={generating} className="btn-primary inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl font-medium disabled:opacity-60">{generating ? <Loader2 className="h-5 w-5 animate-spin" /> : <WandSparkles className="h-5 w-5" />}{generating ? "正在生成并保存音频…" : "生成音频"}</button>
        </form>
      </section>

      {latestGeneration ? <section className="space-y-3"><div><h2 className="text-base font-semibold">本次结果</h2><p className="mt-1 text-sm text-zinc-500">音频已经保存，可以直接播放或下载。</p></div><DoubaoAudioGenerationCard generation={latestGeneration} featured deleting={deletingId === latestGeneration.id} deleteDisabled={Boolean(deletingId)} onDelete={setDeleteTarget} /></section> : null}

      <section className="glass-effect overflow-hidden rounded-2xl border border-zinc-200/60 dark:border-zinc-800/60">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200/60 px-4 py-4 dark:border-zinc-800/60 sm:px-5"><div><h2 className="flex items-center gap-2 text-base font-semibold"><History className="h-4 w-4 text-primary" />Doubao 音频记录{!generationsLoading && generations.length ? <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800">{generations.length}</span> : null}</h2><p className="mt-1 text-sm text-zinc-500">最多保留最近 100 条。</p></div><button type="button" onClick={loadGenerations} disabled={generationsLoading} className="inline-flex h-10 items-center gap-2 rounded-xl border border-zinc-200 px-3 text-sm font-medium text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200"><RefreshCw className={`h-4 w-4 ${generationsLoading ? "animate-spin" : ""}`} />刷新</button></div>
        <div className="p-3 sm:p-4">
          {generationsError ? <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600" role="alert">{generationsError}</div> : null}
          {generationsLoading ? <HistorySkeleton /> : !generations.length ? <div className="flex min-h-[180px] flex-col items-center justify-center rounded-xl border border-dashed border-zinc-200 px-6 text-center dark:border-zinc-800"><AudioLines className="h-7 w-7 text-primary" /><p className="mt-3 text-sm font-medium">还没有 Doubao 音频记录</p><p className="mt-1 text-xs text-zinc-500">完成首次生成后，结果会安全保存在这里。</p></div> : !history.length ? <p className="py-8 text-center text-sm text-zinc-500">当前只有上方这条新记录。</p> : <div className="fade-scrollbar max-h-[520px] space-y-2 overflow-y-auto pr-1"><AnimatePresence initial={false}>{history.map((generation) => <DoubaoAudioGenerationCard key={generation.id} generation={generation} deleting={deletingId === generation.id} deleteDisabled={Boolean(deletingId)} onDelete={setDeleteTarget} />)}</AnimatePresence></div>}
        </div>
      </section>

      <MediaConfirmDialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} onConfirm={confirmDelete} title="删除 Doubao 音频记录" message="确定删除这条音频吗？音频文件也会一并删除，之后无法恢复。" confirmText="删除音频" danger />
    </div>
  );
}
