"use client";

import { useI18n } from "@/lib/client/i18n";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Loader2, Mic2, Play } from "lucide-react";
import AudioFormError from "./AudioFormError";
import AudioGeneratingBanner from "./AudioGeneratingBanner";
import AudioHistorySection from "./AudioHistorySection";
import AudioWorkspaceTabs from "./AudioWorkspaceTabs";
import ApplyGlobalMediaButton from "./ApplyGlobalMediaButton";
import ConfirmModal from "../modals/ConfirmModal";
import { AUDIO_PROVIDERS, inputClass } from "./audioProviders";
import { readLocalSetting, writeLocalSetting } from "@/lib/client/localSettings";
import { playNewGenerationOnce } from "@/lib/media/client/audioAutoPlay.mjs";
import { createAudioClient } from "@/lib/media/client/audio";

const buttonClass = "inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700";

export default function AudioWorkspace({ provider, onBusyChange, canManageDefaults = false, serviceEnabled = true }) {
  const { t, formatDate, formatNumber } = useI18n();
  const config = AUDIO_PROVIDERS[provider];
  const api = useMemo(() => createAudioClient(provider), [provider]);
  const voiceKey = `vectaix_ui_${provider}AudioVoice_v1`;
  const { Options, CloneOptions } = config;

  const tabs = [{ id: "synthesis", label: t("文字配音", "Text to speech"), icon: AudioLines }, { id: "voices", label: t("声音复刻", "Voice cloning"), icon: Mic2 }];
  const [tab, setTab] = useState("synthesis");
  const [text, setText] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [selectedName, setSelectedName] = useState("");
  const [voices, setVoices] = useState([]);
  const [query, setQuery] = useState("");
  const [voicesLoading, setVoicesLoading] = useState(true);
  const [voiceError, setVoiceError] = useState("");
  const [options, setOptions] = useState(config.defaults);
  const [generations, setGenerations] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyCursor, setHistoryCursor] = useState(null);
  const [moreLoading, setMoreLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [error, setError] = useState("");
  const [operation, setOperation] = useState("");
  const [defaultsSaving, setDefaultsSaving] = useState(false);
  const [preview, setPreview] = useState(null);
  const workspaceRef = useRef(null);
  const [displayName, setDisplayName] = useState("");
  const [sample, setSample] = useState(null);
  const [consent, setConsent] = useState(false);
  const [cloneOptions, setCloneOptions] = useState(config.cloneDefaults);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const pendingAutoPlay = useRef("");
  const historyRequest = useRef(0);
  const operationLock = useRef(false);
  const busy = Boolean(operation) || defaultsSaving;
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  const isReady = voice => config.readyStatuses.includes(voice.status);
  const search = query.trim().toLocaleLowerCase();
  const filteredVoices = voices.filter(voice => `${voice.displayName} ${voice.description || ""}`.toLocaleLowerCase().includes(search));
  const parameters = { provider, model: config.model, voiceId, ...options };

  const loadHistory = useCallback(async () => {
    const request = ++historyRequest.current;
    setHistoryLoading(true); setHistoryError("");
    try {
      const data = await api.listGenerations();
      if (request === historyRequest.current) { setGenerations(data.generations); setHistoryCursor(data.nextCursor); }
    } catch (error) { if (request === historyRequest.current) setHistoryError(error.message); }
    finally { if (request === historyRequest.current) setHistoryLoading(false); }
  }, [api]);

  useEffect(() => {
    let active = true;
    const request = historyRequest.current;
    api.listGenerations().then(data => {
      if (active && request === historyRequest.current) { setGenerations(data.generations); setHistoryCursor(data.nextCursor); }
    }).catch(error => {
      if (active && request === historyRequest.current) setHistoryError(error.message);
    }).finally(() => {
      if (active && request === historyRequest.current) setHistoryLoading(false);
    });
    return () => { active = false; };
  }, [api]);
  useEffect(() => {
    const controller = new AbortController();
    api.listVoices({ signal: controller.signal }).then(data => {
      if (controller.signal.aborted) return;
      setVoices(data.voices);
      const saved = readLocalSetting(voiceKey);
      const restored = data.voices.find(voice => voice.voiceId === saved && config.readyStatuses.includes(voice.status));
      if (restored) {
        setVoiceId(restored.voiceId);
        setSelectedName(restored.displayName);
      } else if (saved) writeLocalSetting(voiceKey, null);
    }).catch(error => { if (error.name !== "AbortError") setVoiceError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setVoicesLoading(false); });
    return () => controller.abort();
  }, [api, voiceKey, config]);
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview]);
  useEffect(() => {
    const container = workspaceRef.current;
    const pauseOthers = event => {
      if (!(event.target instanceof HTMLAudioElement)) return;
      container.querySelectorAll("audio").forEach(audio => { if (audio !== event.target && !audio.paused) audio.pause(); });
    };
    container.addEventListener("play", pauseOthers, true);
    return () => container.removeEventListener("play", pauseOthers, true);
  }, []);

  async function loadMoreHistory() {
    const request = ++historyRequest.current;
    setMoreLoading(true); setHistoryError('');
    try {
      const data = await api.listGenerations({ cursor: historyCursor });
      if (request === historyRequest.current) { setGenerations(current => [...current, ...data.generations]); setHistoryCursor(data.nextCursor); }
    } catch (error) { if (request === historyRequest.current) setHistoryError(error.message); }
    finally { setMoreLoading(false); }
  }

  async function run(name, action) {
    if (operationLock.current || defaultsSaving) return;
    operationLock.current = true; setOperation(name); setError("");
    try { await action(); } catch (error) { setError(error.message); }
    finally { operationLock.current = false; setOperation(""); }
  }
  function selectVoice(voice) {
    setVoiceId(voice.voiceId); setSelectedName(voice.displayName);
    writeLocalSetting(voiceKey, voice.voiceId);
  }
  function clearVoice() {
    setVoiceId(""); setSelectedName(""); writeLocalSetting(voiceKey, null);
  }
  function generate(event) {
    event.preventDefault();
    void run("generate", async () => {
      const { provider: _provider, ...body } = parameters;
      const data = await api.createGeneration({ ...body, text: text.trim() });
      historyRequest.current += 1; setHistoryLoading(false);
      pendingAutoPlay.current = data.generation.id;
      setGenerations(current => [data.generation, ...current.filter(item => item.id !== data.generation.id)]);
      setVoices(current => current.map(voice => voice.voiceId === data.generation.voiceId && voice.status === "pending_activation" ? { ...voice, status: "trained" } : voice));
    });
  }
  function clone(event) {
    event.preventDefault();
    const form = event.currentTarget;
    void run("clone", async () => {
      const data = new FormData(); data.set("displayName", displayName.trim()); data.set("sample", sample); data.set("consentConfirmed", String(consent));
      for (const [key, value] of Object.entries(cloneOptions)) data.set(key, String(value));
      const result = await api.createVoice(data);
      setVoices(current => [result.voice, ...current]);
      setDisplayName(""); setSample(null); setConsent(false); setCloneOptions(config.cloneDefaults); form.reset();
    });
  }
  function remove() {
    const target = deleteTarget; setDeleteTarget(null);
    void run("delete", async () => {
      if (target.type === "voice") {
        await api.deleteVoice(target.item.profileId);
        setVoices(current => current.filter(item => item.profileId !== target.item.profileId));
        if (voiceId === target.item.voiceId) clearVoice();
      } else {
        await api.deleteGeneration(target.item.id);
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
    const ready = isReady(voice);
    return <div key={voice.profileId} className={`rounded-xl border p-3 transition-colors ${voiceId === voice.voiceId ? "border-primary bg-primary/5" : "border-zinc-200 dark:border-zinc-700"}`}>
      <button type="button" disabled={busy || !ready} aria-pressed={voiceId === voice.voiceId} onClick={() => selectVoice(voice)} className="w-full rounded-lg text-left disabled:cursor-not-allowed disabled:opacity-50">
        <span className="block truncate text-sm font-medium">{name}</span>
        <span className="mt-1 block line-clamp-2 text-xs text-zinc-500">{voice.description || config.statusLabel(voice, { t, formatDate })}</span>
        {voice.shared && <span className="mt-1 block text-xs text-primary">{t('管理员共享音色', 'Voice shared by the administrator')}</span>}
      </button>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={buttonClass} disabled={busy || !ready || !serviceEnabled} aria-label={t("试听 {name}", "Preview {name}", { name })} onClick={() => void run("preview", async () => {
          setPreview({ voiceId: voice.voiceId, url: await api.previewVoice(voice.voiceId) });
          if (voice.status === "pending_activation") setVoices(current => current.map(item => item.profileId === voice.profileId ? { ...item, status: "trained" } : item));
        })}>{operation === "preview" ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <Play className="h-3.5 w-3.5" />}{t("试听", "Preview")}</button>
        {!voice.builtin && !voice.shared && <><button type="button" disabled={busy} className={buttonClass} onClick={() => void run("refresh", async () => {
          const result = await api.refreshVoice(voice.profileId);
          setVoices(current => current.map(item => item.profileId === voice.profileId ? result.voice : item));
          if (voiceId === voice.voiceId && !isReady(result.voice)) clearVoice();
        })}>{t("刷新状态", "Refresh status")}</button>
        <button type="button" disabled={busy} className={`${buttonClass} hover:text-red-600`} onClick={() => setDeleteTarget({ type: "voice", item: voice })}>{t("删除音色", "Delete voice")}</button></>}
      </div>
      {preview?.voiceId === voice.voiceId && <audio key={preview.url} src={preview.url} controls autoPlay className="mt-3 h-10 w-full" aria-label={t("音色试听", "Voice preview")} />}
    </div>;
  }

  const ownVoices = voices.filter(voice => !voice.builtin && !voice.shared);
  return <div ref={workspaceRef} className="space-y-5">
    <AudioWorkspaceTabs idPrefix={`${provider}-audio`} tabs={tabs} activeTab={tab} onChange={setTab} ariaLabel={t("配音功能", "Audio tools")} disabled={busy || voicesLoading} />
    <AudioFormError message={error} />
    <section id={`${provider}-audio-panel-${tab}`} role="tabpanel" aria-labelledby={`${provider}-audio-tab-${tab}`}>
      {tab === "synthesis" ? <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.75fr)]">
        <form onSubmit={generate} className="min-w-0 space-y-5 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 sm:p-6">
          <h2 className="font-semibold">{t("配音文本", "Speech text")}</h2>
          <label htmlFor={`${provider}-text`} className="sr-only">{t("配音文本", "Speech text")}</label>
          <textarea id={`${provider}-text`} value={text} onChange={event => setText(event.target.value)} maxLength={config.maxTextLength} required rows={9} disabled={busy} placeholder={t("输入想说的话，例如：你好，欢迎来到今天的故事。", "Enter your text, for example: Hello, and welcome to today’s story.")} className={`${inputClass} resize-y leading-7`} />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500"><span>{config.textHint(t)}</span><span>{formatNumber(text.length)} / {formatNumber(config.maxTextLength)}</span></div>
          <p className="text-sm">{t("当前音色：", "Selected voice: ")}<strong>{selectedName || t("请从声音库选择", "Choose a voice from the library")}</strong></p>
          <Options value={options} disabled={busy} onChange={changes => setOptions(current => ({ ...current, ...changes }))} />
          <button type="submit" disabled={!serviceEnabled || busy || !text.trim() || !voiceId} className="btn-primary flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50">{operation === "generate" ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <AudioLines className="h-4 w-4" />}{operation === "generate" ? t("正在生成", "Generating") : t("生成语音", "Generate speech")}</button>
          {canManageDefaults && <ApplyGlobalMediaButton section={config.settingsSection} audioProvider={provider} value={parameters} disabled={busy || !voiceId} onBusyChange={setDefaultsSaving} />}
        </form>
        <section aria-label={t("声音库", "Voice library")} className="min-w-0 space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-700">
          <h2 className="font-semibold">{t("声音库", "Voice library")}</h2>
          <div><label htmlFor={`${provider}-voice-search`} className="sr-only">{t("搜索音色", "Search voices")}</label><input id={`${provider}-voice-search`} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t("搜索音色名称或描述", "Search voice names or descriptions")} className={inputClass} disabled={busy || voicesLoading} /></div>
          <AudioFormError message={voiceError} />
          {voicesLoading ? <p role="status" className="text-sm text-zinc-500">{t("正在读取音色…", "Loading voices…")}</p> : <>
            <div className="fade-scrollbar max-h-[540px] space-y-3 overflow-y-auto">{filteredVoices.map(voiceCard)}{!voiceError && (voices.length === 0 ? <div className="space-y-3 text-sm text-zinc-500"><p>{t("先复刻一个声音，即可在这里选择并生成配音。", "Clone a voice first, then select it here to generate speech.")}</p><button type="button" className={buttonClass} disabled={busy} onClick={() => setTab("voices")}>{t("复刻声音", "Clone a voice")}</button></div> : filteredVoices.length === 0 && <p className="text-sm text-zinc-500">{t("没有找到匹配的声音。", "No matching voices found.")}</p>)}</div>
          </>}
        </section>
      </div> : <div className="space-y-5">
        <form onSubmit={clone} className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 sm:p-6">
          <h2 className="font-semibold">{t("复刻音色", "Clone a voice")}</h2><p className="text-sm text-zinc-500">{config.cloneHint(t)}</p>
          <div><label htmlFor={`${provider}-voice-name`} className="mb-2 block text-sm">{t("音色名称", "Voice name")}</label><input id={`${provider}-voice-name`} required maxLength={60} value={displayName} onChange={event => setDisplayName(event.target.value)} disabled={busy} className={inputClass} /></div>
          <div><label htmlFor={`${provider}-sample`} className="mb-2 block text-sm">{t("声音样本", "Voice sample")}</label><input id={`${provider}-sample`} type="file" required accept=".wav,.mp3,.m4a,audio/wav,audio/mpeg,audio/mp4" disabled={busy} className={inputClass} onChange={event => setSample(event.target.files[0] || null)} /></div>
          {CloneOptions && <CloneOptions value={cloneOptions} disabled={busy} onChange={changes => setCloneOptions(current => ({ ...current, ...changes }))} />}
          <label className="flex cursor-pointer items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={busy} required className="mt-0.5 h-4 w-4 shrink-0 accent-primary" />{t("我拥有这段录音的使用权，并已获得声音本人的授权。", "I have the right to use this recording and the speaker’s permission.")}</label>
          <button type="submit" disabled={!serviceEnabled || busy || !sample || !consent || !displayName.trim()} className="btn-primary rounded-xl px-5 py-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50">{operation === "clone" ? t("正在创建…", "Creating…") : t("创建音色", "Create voice")}</button>
        </form>
        <AudioFormError message={voiceError} />
        {ownVoices.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{ownVoices.map(voiceCard)}</div> : !voicesLoading && <p className="text-sm text-zinc-500">{t("还没有复刻的音色。上传录音后会显示在这里。", "No cloned voices yet. Upload a recording to add one.")}</p>}
      </div>}
    </section>
    {operation === "generate" && <AudioGeneratingBanner />}
    <AudioHistorySection description={t("记录保存在你的账号下，可播放、下载或删除。", "Recordings stay in your account. Play, download, or delete them here.")} items={generations} loading={historyLoading} error={historyError} onRefresh={loadHistory} hasMore={Boolean(historyCursor)} loadingMore={moreLoading} onLoadMore={loadMoreHistory} renderItem={generation => <article key={generation.id} className="min-w-0 space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="min-w-0 truncate text-sm font-medium">{generation.voiceName}</h3><span className="text-xs text-zinc-500">{formatDate(generation.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span></div>
      <p className="line-clamp-3 break-words text-sm leading-6 text-zinc-600">{generation.text}</p>
      <audio ref={audioRef} data-generation-id={generation.id} controls preload="none" src={generation.audioUrl} className="w-full" aria-label={t("{name} 生成的语音", "Speech generated with {name}", { name: generation.voiceName })} />
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500"><span className="mr-auto tabular-nums">{generation.format.toUpperCase()} · {formatNumber(generation.sampleRate / 1000)} kHz · {formatNumber(generation.speed)}×</span><a href={`${generation.audioUrl}?download=1`} className={buttonClass}>{t("下载音频", "Download audio")}</a><button type="button" disabled={busy} onClick={() => setDeleteTarget({ type: "generation", item: generation })} className={`${buttonClass} hover:text-red-600`}>{t("删除记录", "Delete recording")}</button></div>
    </article>} />
    <ConfirmModal open={Boolean(deleteTarget)} title={deleteTarget?.type === "voice" ? t("删除音色", "Delete voice") : t("删除语音记录", "Delete recording")} message={deleteTarget?.type === "voice" ? t("此音色和声音样本将被删除。", "This voice and its sample recording will be deleted.") : t("此记录和生成的音频文件将被删除。", "This recording and its audio file will be deleted.")} danger confirmText={t("删除", "Delete")} onClose={() => setDeleteTarget(null)} onConfirm={remove} />
  </div>;
}
