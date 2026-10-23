"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AudioLines, Gauge, Loader2, Mic2, Play, Volume2 } from "lucide-react";
import AudioFormError from "./AudioFormError";
import AudioGeneratingBanner from "./AudioGeneratingBanner";
import AudioHistorySection from "./AudioHistorySection";
import AudioSliderField from "./AudioSliderField";
import AudioWorkspaceTabs from "./AudioWorkspaceTabs";
import UseInChatButton from "./UseInChatButton";
import MediaConfirmDialog from "./MediaConfirmDialog";
import { readLocalSetting, writeLocalSetting } from "@/lib/client/localSettings";
import { playNewGenerationOnce } from "@/lib/media/client/audioAutoPlay.mjs";
import { createFishGeneration, createFishVoice, deleteFishGeneration, deleteFishVoice, listFishGenerations, listFishVoices, previewFishVoice, refreshFishVoice } from "@/lib/media/client/fishAudio";
import { FISH_AUDIO_MODEL, FISH_AUDIO_MODEL_LABEL, FISH_AUDIO_TEXT_MAX_LENGTH, FISH_AUDIO_SAMPLE_RATES } from "@/lib/media/shared/fishAudio";

const VOICE_KEY = "vectaix_ui_fishAudioVoice_v1";
const tabs = [{ id: "synthesis", label: "文字配音", icon: AudioLines }, { id: "voices", label: "声音复刻", icon: Mic2 }];
const inputClass = "w-full rounded-xl border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-700 dark:bg-zinc-950";
const buttonClass = "rounded-xl border border-zinc-200 px-3 py-2 text-sm disabled:opacity-50 dark:border-zinc-700";
const statusLabels = { created: "等待处理", training: "正在复刻", trained: "可用", failed: "复刻失败" };

export default function FishAudioWorkspace() {
  const [tab, setTab] = useState("synthesis");
  const [text, setText] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [selectedName, setSelectedName] = useState("");
  const [voices, setVoices] = useState([]);
  const [query, setQuery] = useState("");
  const [voicesLoading, setVoicesLoading] = useState(true);
  const [voiceError, setVoiceError] = useState("");
  const [format, setFormat] = useState("mp3");
  const [sampleRate, setSampleRate] = useState(44100);
  const [speed, setSpeed] = useState(1);
  const [volume, setVolume] = useState(0);
  const [generations, setGenerations] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [error, setError] = useState("");
  const [operation, setOperation] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [sample, setSample] = useState(null);
  const [consent, setConsent] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const pendingAutoPlay = useRef("");
  const historyRequest = useRef(0);
  const operationLock = useRef(false);
  const busy = Boolean(operation) || chatBusy;
  const filteredVoices = voices.filter(voice => voice.displayName.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const parameters = { provider: "fish", model: FISH_AUDIO_MODEL, voiceId, format, sampleRate, speed, volume, temperature: 0.7, topP: 0.7 };

  const loadHistory = useCallback(async () => {
    const request = ++historyRequest.current;
    setHistoryLoading(true); setHistoryError("");
    try {
      const data = await listFishGenerations();
      if (request === historyRequest.current) setGenerations(data.generations);
    } catch (error) { if (request === historyRequest.current) setHistoryError(error.message); }
    finally { if (request === historyRequest.current) setHistoryLoading(false); }
  }, []);

  useEffect(() => {
    let active = true;
    const request = historyRequest.current;
    listFishGenerations().then(data => {
      if (active && request === historyRequest.current) setGenerations(data.generations);
    }).catch(error => {
      if (active && request === historyRequest.current) setHistoryError(error.message);
    }).finally(() => {
      if (active && request === historyRequest.current) setHistoryLoading(false);
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    listFishVoices({ signal: controller.signal }).then(data => {
      if (controller.signal.aborted) return;
      setVoices(data.voices);
      const saved = readLocalSetting(VOICE_KEY);
      const restored = data.voices.find(voice => voice.voiceId === saved && voice.status === "trained");
      if (restored) {
        setVoiceId(restored.voiceId);
        setSelectedName(restored.displayName);
      } else if (saved) writeLocalSetting(VOICE_KEY, null);
    }).catch(error => { if (error.name !== "AbortError") setVoiceError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setVoicesLoading(false); });
    return () => controller.abort();
  }, []);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  async function run(name, action) {
    if (operationLock.current || chatBusy) return;
    operationLock.current = true; setOperation(name); setError("");
    try { await action(); } catch (error) { setError(error.message); }
    finally { operationLock.current = false; setOperation(""); }
  }
  function selectVoice(voice) {
    setVoiceId(voice.voiceId); setSelectedName(voice.displayName);
    writeLocalSetting(VOICE_KEY, voice.voiceId);
  }
  function generate(event) {
    event.preventDefault();
    void run("generate", async () => {
      const { provider: _provider, ...options } = parameters;
      const data = await createFishGeneration({ ...options, text: text.trim() });
      historyRequest.current += 1; setHistoryLoading(false);
      pendingAutoPlay.current = data.generation.id;
      setGenerations(current => [data.generation, ...current.filter(item => item.id !== data.generation.id)].slice(0, 100));
    });
  }
  function clone(event) {
    event.preventDefault();
    const form = event.currentTarget;
    void run("clone", async () => {
      const data = new FormData(); data.set("displayName", displayName.trim()); data.set("sample", sample); data.set("consentConfirmed", String(consent));
      const result = await createFishVoice(data);
      setVoices(current => [result.voice, ...current]);
      setDisplayName(""); setSample(null); setConsent(false); form.reset();
    });
  }
  function remove() {
    const target = deleteTarget; setDeleteTarget(null);
    void run("delete", async () => {
      if (target.type === "voice") {
        await deleteFishVoice(target.item.profileId);
        setVoices(current => current.filter(item => item.profileId !== target.item.profileId));
        if (voiceId === target.item.voiceId) { setVoiceId(""); setSelectedName(""); writeLocalSetting(VOICE_KEY, null); }
      } else {
        await deleteFishGeneration(target.item.id);
        historyRequest.current += 1; setHistoryLoading(false);
        setGenerations(current => current.filter(item => item.id !== target.item.id));
      }
    });
  }
  const audioRef = useCallback(element => {
    if (element) playNewGenerationOnce({ generationId: element.dataset.generationId, pendingGenerationIdRef: pendingAutoPlay, audioElement: element });
  }, []);

  function voiceCard(voice) {
    const name = voice.displayName;
    const ready = voice.status === "trained";
    return <div key={voice.profileId} className={`rounded-xl border p-3 ${voiceId === voice.voiceId ? "border-primary bg-primary/5" : "border-zinc-200 dark:border-zinc-800"}`}>
      <button type="button" disabled={busy || !ready} aria-pressed={voiceId === voice.voiceId} onClick={() => selectVoice(voice)} className="w-full text-left disabled:opacity-50">
        <span className="block truncate text-sm font-medium">{name}</span>
        <span className="mt-1 block line-clamp-2 text-xs text-zinc-500">{statusLabels[voice.status]}</span>
      </button>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={buttonClass} disabled={busy || !ready} aria-label={`试听 ${name}`} onClick={() => void run("preview", async () => setPreviewUrl(await previewFishVoice(voice.voiceId)))}><Play className="mr-1 inline h-3 w-3" />试听</button>
        <button type="button" disabled={busy} className={buttonClass} onClick={() => void run("refresh", async () => {
          const result = await refreshFishVoice(voice.profileId);
          setVoices(current => current.map(item => item.profileId === voice.profileId ? result.voice : item));
          if (voiceId === voice.voiceId && result.voice.status !== "trained") { setVoiceId(""); setSelectedName(""); writeLocalSetting(VOICE_KEY, null); }
        })}>刷新状态</button>
        <button type="button" disabled={busy} className={buttonClass} onClick={() => setDeleteTarget({ type: "voice", item: voice })}>删除音色</button>
      </div>
    </div>;
  }

  return <div className="space-y-5">
    <AudioWorkspaceTabs idPrefix="fish-audio" tabs={tabs} activeTab={tab} onChange={setTab} ariaLabel="配音功能" disabled={busy || voicesLoading} />
    <AudioFormError message={error} />
    {previewUrl && <audio key={previewUrl} src={previewUrl} controls autoPlay className="w-full" aria-label="音色试听" />}
    <section id={`fish-audio-panel-${tab}`} role="tabpanel" aria-labelledby={`fish-audio-tab-${tab}`}>
      {tab === "synthesis" ? <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.75fr)]">
        <form onSubmit={generate} className="glass-effect space-y-5 rounded-2xl border border-zinc-200/60 p-5 dark:border-zinc-800/60 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">配音文本</h2><span className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">{FISH_AUDIO_MODEL_LABEL}</span></div>
          <label htmlFor="fish-text" className="sr-only">配音文本</label>
          <textarea id="fish-text" value={text} onChange={event => setText(event.target.value)} maxLength={FISH_AUDIO_TEXT_MAX_LENGTH} required rows={9} disabled={busy} placeholder="输入想说的话，例如：[轻声] 你好，欢迎来到今天的故事。" className={`${inputClass} resize-y leading-7`} />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500"><span>语言自动识别，可用 [轻声]、[兴奋] 描述表达方式。</span><span>{text.length.toLocaleString()} / {FISH_AUDIO_TEXT_MAX_LENGTH.toLocaleString()}</span></div>
          <p className="text-sm">当前音色：<strong>{selectedName || "请从声音库选择"}</strong></p>
          <div className="grid grid-cols-2 gap-3">
            <div><label htmlFor="fish-format" className="mb-2 block text-xs">音频格式</label><select id="fish-format" value={format} disabled={busy} onChange={event => { setFormat(event.target.value); setSampleRate(44100); }} className={inputClass}><option value="mp3">MP3</option><option value="wav">WAV</option></select></div>
            <div><label htmlFor="fish-sample-rate" className="mb-2 block text-xs">采样率</label><select id="fish-sample-rate" value={sampleRate} disabled={busy} onChange={event => setSampleRate(Number(event.target.value))} className={inputClass}>{FISH_AUDIO_SAMPLE_RATES[format].map(rate => <option value={rate} key={rate}>{rate / 1000} kHz</option>)}</select></div>
            <AudioSliderField id="fish-speed" label="语速" icon={Gauge} valueLabel={`${speed.toFixed(1)}×`} value={speed} min={0.5} max={2} step={0.1} disabled={busy} onChange={event => setSpeed(Number(event.target.value))} />
            <AudioSliderField id="fish-volume" label="音量" icon={Volume2} valueLabel={`${volume} dB`} value={volume} min={-20} max={20} step={1} disabled={busy} onChange={event => setVolume(Number(event.target.value))} />
          </div>
          <button type="submit" disabled={busy || !text.trim() || !voiceId} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 dark:text-sky-950">{operation === "generate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <AudioLines className="h-4 w-4" />}{operation === "generate" ? "正在生成" : "生成语音"}</button>
          <UseInChatButton section="audio" value={parameters} disabled={busy || !voiceId} onBusyChange={setChatBusy} />
        </form>
        <section aria-label="声音库" className="glass-effect space-y-4 rounded-2xl border border-zinc-200/60 p-5 dark:border-zinc-800/60">
          <h2 className="font-semibold">声音库</h2>
          <div><label htmlFor="fish-voice-search" className="sr-only">搜索音色</label><input id="fish-voice-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索我的声音" className={inputClass} disabled={busy || voicesLoading} /></div>
          <AudioFormError message={voiceError} />
          {voicesLoading ? <p role="status" className="text-sm text-zinc-500">正在读取音色…</p> : <>
            <div className="max-h-[540px] space-y-3 overflow-y-auto">{filteredVoices.map(voiceCard)}{!voiceError && (voices.length === 0 ? <div className="space-y-3 text-sm text-zinc-500"><p>先复刻一个声音，即可在这里选择并生成配音。</p><button type="button" className={buttonClass} disabled={busy} onClick={() => setTab("voices")}>复刻声音</button></div> : filteredVoices.length === 0 && <p className="text-sm text-zinc-500">没有找到匹配的声音。</p>)}</div>
          </>}
        </section>
      </div> : <div className="space-y-5">
        <form onSubmit={clone} className="glass-effect space-y-4 rounded-2xl border border-zinc-200/60 p-6 dark:border-zinc-800/60">
          <h2 className="font-semibold">复刻自己的声音</h2><p className="text-sm text-zinc-500">上传清晰的单人录音，时长 10 秒至 5 分钟，支持 WAV、MP3、M4A，大小最多 20MB。</p>
          <div><label htmlFor="fish-voice-name" className="mb-2 block text-sm">音色名称</label><input id="fish-voice-name" required maxLength={60} value={displayName} onChange={event => setDisplayName(event.target.value)} disabled={busy} className={inputClass} /></div>
          <div><label htmlFor="fish-sample" className="mb-2 block text-sm">声音样本</label><input id="fish-sample" type="file" required accept=".wav,.mp3,.m4a,audio/wav,audio/mpeg,audio/mp4" disabled={busy} className={inputClass} onChange={event => setSample(event.target.files[0] || null)} /></div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={busy} required className="mt-1" />我拥有这段录音的使用权，并已获得声音本人的授权。</label>
          <button type="submit" disabled={busy || !sample || !consent || !displayName.trim()} className="rounded-xl bg-primary px-5 py-3 text-sm font-medium text-white disabled:opacity-50">{operation === "clone" ? "正在提交…" : "创建音色"}</button>
        </form>
        <AudioFormError message={voiceError} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{voices.map(voiceCard)}</div>
      </div>}
    </section>
    {operation === "generate" && <AudioGeneratingBanner />}
    <AudioHistorySection description="最多保留最近 100 条，可直接播放或下载。" items={generations} loading={historyLoading} error={historyError} onRefresh={loadHistory} renderItem={generation => <article key={generation.id} className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">{generation.voiceName}</h3><span className="text-xs text-zinc-500">{new Date(generation.createdAt).toLocaleString("zh-CN")}</span></div>
      <p className="line-clamp-3 text-sm leading-6 text-zinc-600 dark:text-zinc-300">{generation.text}</p>
      <audio ref={audioRef} data-generation-id={generation.id} controls preload="none" src={generation.audioUrl} className="w-full" aria-label={`${generation.voiceName} 生成的语音`} />
      <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500"><span>{generation.format.toUpperCase()} · {generation.sampleRate / 1000} kHz · {generation.speed}×</span><a href={`${generation.audioUrl}?download=1`} className="text-primary">下载音频</a><button type="button" disabled={busy} onClick={() => setDeleteTarget({ type: "generation", item: generation })} className="disabled:opacity-50">删除记录</button></div>
    </article>} />
    <MediaConfirmDialog open={Boolean(deleteTarget)} title={deleteTarget?.type === "voice" ? "删除音色" : "删除语音记录"} message={deleteTarget?.type === "voice" ? "此音色和声音样本将被删除。" : "此记录和生成的音频文件将被删除。"} danger confirmText="删除" onClose={() => setDeleteTarget(null)} onConfirm={remove} />
  </div>;
}
