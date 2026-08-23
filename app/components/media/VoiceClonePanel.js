"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  CheckCircle2,
  CircleAlert,
  Clock3,
  Loader2,
  Mic2,
  Pencil,
  RefreshCw,
  Replace,
  ShieldCheck,
  Trash2,
  UserRoundPlus,
} from "lucide-react";
import AudioFilePicker from "@/app/components/media/AudioFilePicker";
import AudioFormError from "@/app/components/media/AudioFormError";
import AudioSourceClipField from "@/app/components/media/AudioSourceClipField";
import MediaConfirmDialog from "@/app/components/media/MediaConfirmDialog";
import MediaSelect from "@/app/components/media/MediaSelect";
import VoiceEditDialog from "@/app/components/media/VoiceEditDialog";
import {
  AUDIO_LANGUAGE_HINTS,
  CUSTOM_VOICE_MAX_COUNT,
} from "@/lib/media/shared/models";
import {
  AUDIO_UPLOAD_ACCEPT,
  AUDIO_UPLOAD_EXTENSIONS,
  AUDIO_UPLOAD_MAX_BYTES,
  AUDIO_UPLOAD_PURPOSES,
} from "@/lib/media/shared/audioUploads";

const ACCEPTED_AUDIO_EXTENSIONS = new Set(AUDIO_UPLOAD_EXTENSIONS);

const LANGUAGE_OPTIONS = AUDIO_LANGUAGE_HINTS
  .filter((item) => item.id)
  .map((item) => ({ value: item.id, label: item.label }));

const LANGUAGE_LABELS = Object.fromEntries(LANGUAGE_OPTIONS.map((item) => [item.value, item.label]));

const STATUS_META = {
  SUBMITTING: {
    label: "提交中",
    description: "声音样本正在提交，完成后会继续制作音色。",
    icon: Loader2,
    className: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300",
  },
  DEPLOYING: {
    label: "制作中",
    description: "正在制作音色，页面每 10 秒自动同步一次。",
    icon: Clock3,
    className: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300",
  },
  OK: {
    label: "可用",
    description: "音色已经可以用于语音合成。",
    icon: CheckCircle2,
    className: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300",
  },
  UNDEPLOYED: {
    label: "未通过",
    description: "样本审核未通过，可以更换更清晰的声音样本。",
    icon: CircleAlert,
    className: "border-red-200 bg-red-50 text-red-600 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300",
  },
  DELETING: {
    label: "删除中",
    description: "正在释放云端音色并清理声音样本。",
    icon: Trash2,
    className: "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
  },
  RECONCILING: {
    label: "待核对",
    description: "云端结果暂时无法确认，记录与样本已安全保留。",
    icon: CircleAlert,
    className: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/60 dark:bg-orange-950/30 dark:text-orange-300",
  },
};

function getFileError(file) {
  if (!file) return "请选择声音样本";
  if (file.size <= 0) return "声音样本内容为空";
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (!ACCEPTED_AUDIO_EXTENSIONS.has(extension)) {
    return "支持 WAV、MP3、M4A、AAC、FLAC、OGG、Opus 或 WebM 音频";
  }
  if (file.size > AUDIO_UPLOAD_MAX_BYTES) {
    return "单个声音样本不能超过 100MB";
  }
  return "";
}

function formatDate(value) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function VoiceStatus({ status }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span role="status" aria-live="polite" className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium ${meta.className}`}>
      <Icon className={`h-3.5 w-3.5 ${status === "DEPLOYING" || status === "SUBMITTING" || status === "DELETING" ? "animate-pulse motion-reduce:animate-none" : ""}`} />
      {meta.label}
    </span>
  );
}

export default function VoiceClonePanel({
  voices,
  loading,
  error,
  onCreate,
  onRename,
  onReplace,
  onDelete,
  onRefreshVoice,
  onRefreshList,
}) {
  const reduceMotion = useReducedMotion();
  const [displayName, setDisplayName] = useState("");
  const [audio, setAudio] = useState(null);
  const [audioSource, setAudioSource] = useState(null);
  const [languageHint, setLanguageHint] = useState("zh");
  const [enablePreprocess, setEnablePreprocess] = useState(true);
  const [consent, setConsent] = useState(false);
  const [audioInputKey, setAudioInputKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actingVoiceId, setActingVoiceId] = useState("");
  const [dialog, setDialog] = useState(null);
  const [dialogSubmitting, setDialogSubmitting] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [deleteVoice, setDeleteVoice] = useState(null);

  const atLimit = voices.length >= CUSTOM_VOICE_MAX_COUNT;
  const formDisabled = loading || creating || atLimit;
  const voiceActionActive = creating || Boolean(actingVoiceId);

  const handleCreate = async (event) => {
    event.preventDefault();
    setFormError("");
    if (loading) return setFormError("音色列表正在读取，请稍后再创建");
    const trimmedName = displayName.trim();
    if (!trimmedName) {
      setFormError("请填写音色名称");
      return;
    }
    const fileError = getFileError(audio);
    if (fileError) {
      setFormError(fileError);
      return;
    }
    if (audioSource?.status !== "ready" || !audioSource.upload?.fileId) {
      setFormError(audioSource?.error || "请等待声音样本上传和识别完成");
      return;
    }
    if (!consent) {
      setFormError("请先确认声音授权");
      return;
    }
    if (atLimit) {
      setFormError(`每位用户最多保存 ${CUSTOM_VOICE_MAX_COUNT} 个复刻音色`);
      return;
    }

    setCreating(true);
    try {
      await onCreate({
        displayName: trimmedName,
        sampleUploadId: audioSource.upload.fileId,
        clipStart: audioSource.clipStart,
        clipEnd: audioSource.clipEnd,
        languageHint,
        enablePreprocess,
        consent: true,
      });
      setDisplayName("");
      setAudio(null);
      setAudioSource(null);
      setLanguageHint("zh");
      setEnablePreprocess(true);
      setConsent(false);
      setAudioInputKey((current) => current + 1);
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : "创建复刻音色失败";
      setFormError(`${message}。临时样本已清理，请重新选择声音样本`);
      setAudio(null);
      setAudioSource(null);
      setAudioInputKey((current) => current + 1);
      try {
        await onRefreshList();
      } catch {
        // 列表刷新失败时保留原始创建错误。
      }
    } finally {
      setCreating(false);
    }
  };

  const openDialog = (kind, voice) => {
    setActionError("");
    setDialogError("");
    setDialog({ kind, voice });
  };

  const handleDialogSubmit = async (input) => {
    setDialogError("");
    if (!input.displayName) {
      setDialogError("请填写音色名称");
      return;
    }
    if (dialog.kind === "replace") {
      const fileError = getFileError(input.audio);
      if (fileError) {
        setDialogError(fileError);
        return;
      }
      if (!input.consent) {
        setDialogError("请先确认声音授权");
        return;
      }
      if (input.audioSource?.status !== "ready" || !input.audioSource.upload?.fileId) {
        setDialogError(input.audioSource?.error || "请等待新样本上传和识别完成");
        return;
      }
    }

    setDialogSubmitting(true);
    try {
      if (dialog.kind === "rename") {
        await onRename(dialog.voice, input.displayName);
      } else {
        await onReplace(dialog.voice, {
          ...(input.displayName !== dialog.voice.displayName ? { displayName: input.displayName } : {}),
          sampleUploadId: input.audioSource.upload.fileId,
          clipStart: input.audioSource.clipStart,
          clipEnd: input.audioSource.clipEnd,
          consent: true,
        });
      }
      setDialog(null);
    } catch (updateError) {
      setDialogError(updateError instanceof Error ? updateError.message : "更新复刻音色失败");
      if (dialog.kind === "replace") {
        setDialog((current) => current ? {
          ...current,
          uploadRevision: (current.uploadRevision || 0) + 1,
        } : current);
      }
      try {
        await onRefreshList();
      } catch {
        // 列表刷新失败时保留原始更新错误。
      }
    } finally {
      setDialogSubmitting(false);
    }
  };

  const refreshVoice = async (voice) => {
    setActionError("");
    setActingVoiceId(voice.id);
    try {
      await onRefreshVoice(voice);
    } catch (refreshError) {
      setActionError(refreshError instanceof Error ? refreshError.message : "同步音色状态失败");
    } finally {
      setActingVoiceId("");
    }
  };

  const confirmDelete = async () => {
    const voice = deleteVoice;
    setDeleteVoice(null);
    if (!voice) return;
    setActionError("");
    setActingVoiceId(voice.id);
    try {
      await onDelete(voice);
    } catch (deleteError) {
      setActionError(deleteError instanceof Error ? deleteError.message : "删除复刻音色失败");
    } finally {
      setActingVoiceId("");
    }
  };

  return (
    <div className="space-y-6">
      <section className="glass-effect overflow-hidden rounded-2xl border border-zinc-200/60 dark:border-zinc-800/60">
        <div className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
          <div className="p-5 sm:p-6">
            <div className="mb-5 flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <UserRoundPlus className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-lg font-semibold">复刻一个专属音色</h2>
                <p className="mt-1 text-sm leading-6 text-zinc-500">
                  上传一段清晰人声，系统会制作可长期使用的声音角色。
                </p>
              </div>
            </div>

            <form onSubmit={handleCreate} className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="voice-display-name" className="text-sm font-medium">音色名称</label>
                <input
                  id="voice-display-name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  maxLength={40}
                  placeholder="例如：温暖旁白"
                  disabled={formDisabled}
                  className="focus-ring h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </div>

              <div className="space-y-2">
                <span className="text-sm font-medium">声音样本</span>
                {audio ? (
                  <AudioSourceClipField
                    key={`voice-source-${audioInputKey}`}
                    file={audio}
                    purpose={AUDIO_UPLOAD_PURPOSES.VOICE_CLONE}
                    label="声音样本"
                    disabled={formDisabled}
                    onStateChange={setAudioSource}
                    onRemove={() => {
                      setAudio(null);
                      setAudioSource(null);
                      setAudioInputKey((current) => current + 1);
                    }}
                  />
                ) : (
                  <AudioFilePicker
                    id="voice-sample-audio"
                    inputKey={audioInputKey}
                    disabled={formDisabled}
                    accept={AUDIO_UPLOAD_ACCEPT}
                    onChange={(file) => {
                      const fileError = getFileError(file);
                      if (fileError) {
                        setFormError(fileError);
                        setAudioInputKey((current) => current + 1);
                        return;
                      }
                      setAudio(file);
                      setAudioSource(null);
                      setFormError("");
                    }}
                  />
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="voice-language" className="text-sm font-medium">样本语言</label>
                  <MediaSelect
                    id="voice-language"
                    ariaLabel="样本语言"
                    value={languageHint}
                    onChange={setLanguageHint}
                    disabled={formDisabled}
                    options={LANGUAGE_OPTIONS.map((option) => ({ id: option.value, label: option.label }))}
                    size="lg"
                  />
                </div>
                <label className="flex min-h-[68px] items-start gap-3 rounded-xl border border-zinc-200 px-3 py-3 text-sm dark:border-zinc-700">
                  <input
                    type="checkbox"
                    checked={enablePreprocess}
                    onChange={(event) => setEnablePreprocess(event.target.checked)}
                    disabled={formDisabled}
                    className="mt-1 h-4 w-4 shrink-0 accent-primary"
                  />
                  <span>
                    <span className="block font-medium text-zinc-700 dark:text-zinc-200">优化样本噪音</span>
                    <span className="mt-0.5 block text-xs leading-5 text-zinc-500">适合有轻微底噪的录音。</span>
                  </span>
                </label>
              </div>

              <label className="flex items-start gap-3 rounded-xl border border-zinc-200 p-4 text-sm leading-6 dark:border-zinc-700">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                  disabled={formDisabled}
                  className="mt-1 h-4 w-4 shrink-0 accent-primary"
                />
                <span className="text-zinc-600 dark:text-zinc-300">
                  我确认已获得该声音本人明确授权，并同意将样本用于创建复刻音色。
                </span>
              </label>

              <AudioFormError message={formError} />

              {atLimit ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700" role="status">
                  已保存 {CUSTOM_VOICE_MAX_COUNT} 个音色。删除不再使用的音色后，才能继续创建。
                </div>
              ) : null}

              <button
                type="submit"
                disabled={formDisabled || (audio && audioSource?.status !== "ready")}
                className="btn-primary inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl font-medium disabled:opacity-60"
              >
                {creating ? <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" /> : <Mic2 className="h-5 w-5" />}
                {creating ? "正在转换并提交样本…" : "创建复刻音色"}
              </button>
              <div className="sr-only" aria-live="polite">
                {creating ? "正在提交声音样本" : ""}
              </div>
            </form>
          </div>

          <aside className="border-t border-zinc-200/70 bg-zinc-50/60 p-5 dark:border-zinc-800 dark:bg-zinc-900/40 sm:p-6 lg:border-l lg:border-t-0">
            <div className="flex items-center gap-2 text-primary">
              <ShieldCheck className="h-5 w-5" />
              <h3 className="text-sm font-semibold">录音准备要点</h3>
            </div>
            <ul className="mt-4 space-y-4 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
              <li className="border-l-2 border-primary/30 pl-3">
                推荐录制 10–20 秒，允许 5–60 秒；说话要连续、清晰。
              </li>
              <li className="border-l-2 border-primary/30 pl-3">
                只保留一个人的正常说话声，不要上传歌曲、背景音乐或多人对话。
              </li>
              <li className="border-l-2 border-primary/30 pl-3">
                支持 WAV、MP3、M4A、AAC、FLAC、OGG、Opus 和 WebM，上传后会自动转换。
              </li>
              <li className="border-l-2 border-primary/30 pl-3">
                创建后通常先显示“制作中”，完成后会自动变为“可用”。
              </li>
            </ul>
            <div className="mt-6 rounded-2xl border border-zinc-200 bg-white/70 p-4 dark:border-zinc-800 dark:bg-zinc-950/50">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs text-zinc-500">已保存音色</p>
                  <p className="mt-1 text-2xl font-semibold tracking-tight">{voices.length}<span className="ml-1 text-sm font-normal text-zinc-400">/ {CUSTOM_VOICE_MAX_COUNT}</span></p>
                </div>
                <Mic2 className="h-7 w-7 text-primary/50" />
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="my-voices-title">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 id="my-voices-title" className="text-base font-semibold">我的音色</h2>
            <p className="mt-1 text-sm text-zinc-500">管理名称、声音样本和当前制作状态。</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setActionError("");
              onRefreshList();
            }}
            disabled={loading || voiceActionActive}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-zinc-200 px-3 text-sm font-medium text-zinc-700 transition-[background-color,transform] hover:bg-zinc-100 active:scale-[0.98] disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} />
            刷新
          </button>
        </div>

        <AudioFormError message={actionError || error} />

        {loading ? (
          <div className="space-y-3" aria-label="正在读取我的音色" aria-busy="true">
            {[0, 1].map((item) => (
              <div key={item} className="rounded-2xl border border-zinc-200/70 bg-white/80 p-5 dark:border-zinc-800/70 dark:bg-zinc-950/70">
                <div className="mb-4 flex items-center gap-3">
                  <div className="h-10 w-10 animate-pulse rounded-xl bg-zinc-200 motion-reduce:animate-none dark:bg-zinc-800" />
                  <div className="space-y-2">
                    <div className="h-4 w-32 animate-pulse rounded bg-zinc-200 motion-reduce:animate-none dark:bg-zinc-800" />
                    <div className="h-3 w-20 animate-pulse rounded bg-zinc-100 motion-reduce:animate-none dark:bg-zinc-900" />
                  </div>
                </div>
                <div className="h-3 w-2/3 animate-pulse rounded bg-zinc-100 motion-reduce:animate-none dark:bg-zinc-900" />
              </div>
            ))}
          </div>
        ) : voices.length === 0 ? (
          <div className="flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200/80 bg-white/60 px-6 text-center dark:border-zinc-800 dark:bg-zinc-950/50">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Mic2 className="h-6 w-6" />
            </span>
            <p className="mt-4 text-sm font-medium text-zinc-700 dark:text-zinc-200">还没有复刻音色</p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-zinc-500">在上方上传一段清晰的人声样本，创建后会显示在这里。</p>
          </div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence initial={false}>
              {voices.map((voice) => {
                const displayStatus = voice.requiresAttention ? "RECONCILING" : voice.status;
                const status = STATUS_META[displayStatus];
                const busy = actingVoiceId === voice.id;
                return (
                  <motion.article
                    layout={reduceMotion ? false : "position"}
                    key={voice.id}
                    initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
                    className="rounded-2xl border border-zinc-200/70 bg-white/80 p-4 shadow-sm dark:border-zinc-800/70 dark:bg-zinc-950/70 sm:p-5"
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                          <Mic2 className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100">{voice.displayName}</h3>
                            <VoiceStatus status={displayStatus} />
                          </div>
                          <p className="mt-1 text-xs leading-5 text-zinc-500">{status.description}</p>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                            <span>{LANGUAGE_LABELS[voice.languageHint]}样本</span>
                            <span>{voice.enablePreprocess ? "已优化样本噪音" : "保留原始样本"}</span>
                            {voice.sampleFileName ? <span className="max-w-[220px] truncate">{voice.sampleFileName}</span> : null}
                            <span>创建于 {formatDate(voice.createdAt)}</span>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-4 gap-2 sm:flex sm:shrink-0">
                        <button
                          type="button"
                          onClick={() => refreshVoice(voice)}
                          disabled={voiceActionActive || voice.reconciliationKind === "create"}
                          className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800 sm:w-9"
                          aria-label={`同步 ${voice.displayName} 的状态`}
                          title="同步状态"
                        >
                          <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`} />
                        </button>
                        <button
                          type="button"
                          onClick={() => openDialog("rename", voice)}
                          disabled={voiceActionActive || voice.status === "DELETING" || voice.requiresAttention}
                          aria-label={`修改 ${voice.displayName} 的名称`}
                          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 px-2 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 sm:px-3"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">改名</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => openDialog("replace", voice)}
                          disabled={voiceActionActive || !["OK", "UNDEPLOYED"].includes(voice.status)}
                          aria-label={`更换 ${voice.displayName} 的声音样本`}
                          title={!["OK", "UNDEPLOYED"].includes(voice.status) ? "当前状态不能更换样本" : "更换声音样本"}
                          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 px-2 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 sm:px-3"
                        >
                          <Replace className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">换样本</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteVoice(voice)}
                          disabled={voiceActionActive || voice.requiresAttention}
                          aria-label={`删除 ${voice.displayName}`}
                          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 px-2 text-xs font-medium text-zinc-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:border-zinc-700 sm:px-3"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">删除</span>
                        </button>
                      </div>
                    </div>
                  </motion.article>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </section>

      <AnimatePresence>
        {dialog ? (
          <VoiceEditDialog
            key={`${dialog.kind}-${dialog.voice.id}-${dialog.uploadRevision || 0}`}
            dialog={dialog}
            submitting={dialogSubmitting}
            error={dialogError}
            onClose={() => {
              if (!dialogSubmitting) setDialog(null);
            }}
            onSubmit={handleDialogSubmit}
            uploadPurpose={AUDIO_UPLOAD_PURPOSES.VOICE_CLONE}
            uploadAccept={AUDIO_UPLOAD_ACCEPT}
            nameMaxLength={40}
            validateFile={getFileError}
          />
        ) : null}
      </AnimatePresence>

      <MediaConfirmDialog
        open={Boolean(deleteVoice)}
        onClose={() => setDeleteVoice(null)}
        onConfirm={confirmDelete}
        title="删除复刻音色"
        message={`确定删除“${deleteVoice?.displayName || ""}”吗？删除后不能再用于合成，且无法恢复。`}
        confirmText="删除音色"
        danger
      />
    </div>
  );
}
