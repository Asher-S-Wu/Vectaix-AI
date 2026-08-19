"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  CheckCircle2,
  Loader2,
  Mic2,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserRoundPlus,
} from "lucide-react";
import AudioFilePicker from "@/app/components/media/AudioFilePicker";
import AudioFormError from "@/app/components/media/AudioFormError";
import AudioSourceClipField from "@/app/components/media/AudioSourceClipField";
import MediaConfirmDialog from "@/app/components/media/MediaConfirmDialog";
import VoiceEditDialog from "@/app/components/media/VoiceEditDialog";
import { AUDIO_UPLOAD_PURPOSES } from "@/lib/media/shared/audioUploads";
import {
  MINIMAX_AUDIO_LANGUAGE_OPTIONS,
  MINIMAX_AUDIO_MODELS,
  MINIMAX_CUSTOM_VOICE_MAX_COUNT,
  MINIMAX_VOICE_DEMO_TEXT_MAX_LENGTH,
  MINIMAX_VOICE_DISPLAY_NAME_MAX_LENGTH,
} from "@/lib/media/shared/minimaxAudio";

const SAMPLE_ACCEPT = ".mp3,.m4a,.wav,audio/mpeg,audio/mp4,audio/wav";
const SAMPLE_EXTENSIONS = new Set(["mp3", "m4a", "wav"]);

function extension(name) {
  const match = /\.([^.]+)$/.exec(String(name || "").toLowerCase());
  return match ? match[1] : "";
}

function validateSampleFile(file) {
  if (!file) return "请选择声音样本";
  if (file.size <= 0) return "声音样本内容为空";
  if (!SAMPLE_EXTENSIONS.has(extension(file.name))) return "声音样本只支持 MP3、M4A 或 WAV 文件";
  return "";
}

function formatDate(value) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

export default function MinimaxVoiceClonePanel({
  voices,
  loading,
  error,
  onCreate,
  onRename,
  onDelete,
  onRefresh,
}) {
  const reduceMotion = useReducedMotion();
  const [displayName, setDisplayName] = useState("");
  const [demoText, setDemoText] = useState("");
  const [model, setModel] = useState("MiniMax/speech-2.8-hd");
  const [languageBoost, setLanguageBoost] = useState("");
  const [noiseReduction, setNoiseReduction] = useState(false);
  const [volumeNormalization, setVolumeNormalization] = useState(false);
  const [consent, setConsent] = useState(false);
  const [sampleFile, setSampleFile] = useState(null);
  const [sampleState, setSampleState] = useState(null);
  const [sampleInputKey, setSampleInputKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");
  const [actionError, setActionError] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [dialog, setDialog] = useState(null);
  const [dialogSubmitting, setDialogSubmitting] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);

  const atLimit = voices.length >= MINIMAX_CUSTOM_VOICE_MAX_COUNT;
  const voiceActionActive = Boolean(deletingId);

  const resetSample = () => {
    setSampleFile(null);
    setSampleState(null);
    setSampleInputKey((current) => current + 1);
  };

  const submit = async (event) => {
    event.preventDefault();
    setFormError("");
    if (!displayName.trim()) return setFormError("请填写音色名称");
    const sampleError = validateSampleFile(sampleFile);
    if (sampleError) return setFormError(sampleError);
    if (sampleState?.status !== "ready" || !sampleState.upload?.fileId) {
      return setFormError(sampleState?.error || "请等待声音样本上传和识别完成");
    }
    const clipDuration = sampleState.clipEnd - sampleState.clipStart;
    if (clipDuration < 10 || clipDuration > 300) {
      return setFormError("请选择 10 至 300 秒的清晰人声片段");
    }
    if (!consent) return setFormError("请先确认声音授权");
    if (atLimit) return setFormError(`最多只能保存 ${MINIMAX_CUSTOM_VOICE_MAX_COUNT} 个复刻音色`);

    setCreating(true);
    try {
      await onCreate({
        displayName: displayName.trim(),
        sampleUploadId: sampleState.upload.fileId,
        clipStart: sampleState.clipStart,
        clipEnd: sampleState.clipEnd,
        demoText: demoText.trim(),
        model,
        languageBoost,
        noiseReduction,
        volumeNormalization,
        consent: true,
      });
      setDisplayName("");
      setDemoText("");
      setModel("MiniMax/speech-2.8-hd");
      setLanguageBoost("");
      setNoiseReduction(false);
      setVolumeNormalization(false);
      setConsent(false);
      resetSample();
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : "创建复刻音色失败";
      setFormError(`${message}。临时样本已清理，请重新选择声音样本`);
      resetSample();
    } finally {
      setCreating(false);
    }
  };

  const openRenameDialog = (voice) => {
    setActionError("");
    setDialogError("");
    setDialog({ kind: "rename", voice });
  };

  const handleDialogSubmit = async (input) => {
    setDialogError("");
    if (!input.displayName) {
      setDialogError("请填写音色名称");
      return;
    }
    setDialogSubmitting(true);
    try {
      await onRename(dialog.voice, input.displayName);
      setDialog(null);
    } catch (renameError) {
      setDialogError(renameError instanceof Error ? renameError.message : "修改音色失败");
    } finally {
      setDialogSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    const voice = deleteTarget;
    setDeleteTarget(null);
    if (!voice) return;
    setDeletingId(voice.id);
    setActionError("");
    try {
      await onDelete(voice);
    } catch (deleteError) {
      setActionError(deleteError instanceof Error ? deleteError.message : "删除音色失败");
    } finally {
      setDeletingId("");
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
                  上传一段清晰人声，系统会复刻音色并生成试听。
                </p>
              </div>
            </div>

            <form onSubmit={submit} className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="minimax-voice-name" className="text-sm font-medium">音色名称</label>
                  <input
                    id="minimax-voice-name"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    maxLength={MINIMAX_VOICE_DISPLAY_NAME_MAX_LENGTH}
                    placeholder="例如：温柔旁白"
                    disabled={creating || atLimit}
                    className="focus-ring h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="minimax-voice-model" className="text-sm font-medium">试听模型</label>
                  <select
                    id="minimax-voice-model"
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    disabled={creating || atLimit}
                    className="focus-ring h-11 w-full cursor-pointer rounded-xl border border-zinc-200 bg-white px-3 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    {MINIMAX_AUDIO_MODELS.map((item) => (
                      <option key={item.id} value={item.id}>{item.label} · {item.price}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-sm font-medium">声音样本</span>
                {sampleFile ? (
                  <AudioSourceClipField
                    key={`minimax-voice-source-${sampleInputKey}`}
                    file={sampleFile}
                    purpose={AUDIO_UPLOAD_PURPOSES.MINIMAX_VOICE_CLONE}
                    label="声音样本"
                    disabled={creating || atLimit}
                    onStateChange={setSampleState}
                    onRemove={resetSample}
                  />
                ) : (
                  <AudioFilePicker
                    id="minimax-voice-sample"
                    inputKey={sampleInputKey}
                    disabled={creating || atLimit}
                    accept={SAMPLE_ACCEPT}
                    hint="支持 MP3、M4A 或 WAV，选择 10 至 300 秒的清晰人声"
                    onChange={(file) => {
                      const fileError = validateSampleFile(file);
                      if (fileError) {
                        setFormError(fileError);
                        setSampleInputKey((current) => current + 1);
                        return;
                      }
                      setSampleFile(file);
                      setSampleState(null);
                      setFormError("");
                    }}
                  />
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="minimax-voice-demo-text" className="text-sm font-medium">试听文案</label>
                  <span className="text-xs text-zinc-400">
                    选填 · {demoText.length}/{MINIMAX_VOICE_DEMO_TEXT_MAX_LENGTH}
                  </span>
                </div>
                <textarea
                  id="minimax-voice-demo-text"
                  value={demoText}
                  onChange={(event) => setDemoText(event.target.value)}
                  maxLength={MINIMAX_VOICE_DEMO_TEXT_MAX_LENGTH}
                  rows={3}
                  placeholder="填写一段文字，创建完成后会用它生成试听音频。"
                  disabled={creating || atLimit}
                  className="focus-ring min-h-[96px] w-full resize-y rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm leading-6 placeholder:text-zinc-400 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <label htmlFor="minimax-voice-language" className="text-sm font-medium">语言增强</label>
                  <select
                    id="minimax-voice-language"
                    value={languageBoost}
                    onChange={(event) => setLanguageBoost(event.target.value)}
                    disabled={creating || atLimit}
                    className="focus-ring h-11 w-full cursor-pointer rounded-xl border border-zinc-200 bg-white px-3 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    {MINIMAX_AUDIO_LANGUAGE_OPTIONS.map((item) => (
                      <option key={item.id || "none"} value={item.id}>{item.label}</option>
                    ))}
                  </select>
                </div>
                <label className="flex min-h-[68px] items-start gap-3 rounded-xl border border-zinc-200 px-3 py-3 text-sm dark:border-zinc-700">
                  <input
                    type="checkbox"
                    checked={noiseReduction}
                    onChange={(event) => setNoiseReduction(event.target.checked)}
                    disabled={creating || atLimit}
                    className="mt-1 h-4 w-4 shrink-0 accent-primary"
                  />
                  <span>
                    <span className="block font-medium text-zinc-700 dark:text-zinc-200">开启样本降噪</span>
                    <span className="mt-0.5 block text-xs leading-5 text-zinc-500">适合有轻微底噪的录音。</span>
                  </span>
                </label>
                <label className="flex min-h-[68px] items-start gap-3 rounded-xl border border-zinc-200 px-3 py-3 text-sm dark:border-zinc-700">
                  <input
                    type="checkbox"
                    checked={volumeNormalization}
                    onChange={(event) => setVolumeNormalization(event.target.checked)}
                    disabled={creating || atLimit}
                    className="mt-1 h-4 w-4 shrink-0 accent-primary"
                  />
                  <span>
                    <span className="block font-medium text-zinc-700 dark:text-zinc-200">统一样本音量</span>
                    <span className="mt-0.5 block text-xs leading-5 text-zinc-500">避免试听忽大忽小。</span>
                  </span>
                </label>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700" role="note">
                创建时生成的试听会按试听文字正常计费；首次使用复刻音色正式合成时，会收取 9.9 元音色复刻费用。
              </div>

              <label className="flex items-start gap-3 rounded-xl border border-zinc-200 p-4 text-sm leading-6 dark:border-zinc-700">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                  disabled={creating || atLimit}
                  className="mt-1 h-4 w-4 shrink-0 accent-primary"
                />
                <span className="text-zinc-600 dark:text-zinc-300">
                  我确认拥有这段声音的合法使用和复刻授权，并对生成内容负责。
                </span>
              </label>

              <AudioFormError message={formError} />

              {atLimit ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700" role="status">
                  已保存 {MINIMAX_CUSTOM_VOICE_MAX_COUNT} 个音色。删除不再使用的音色后，才能继续创建。
                </div>
              ) : null}

              <button
                type="submit"
                disabled={creating || atLimit || (sampleFile && sampleState?.status !== "ready")}
                className="btn-primary inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl font-medium disabled:opacity-60"
              >
                {creating ? <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" /> : <Mic2 className="h-5 w-5" />}
                {creating ? "正在复刻并生成试听…" : "创建复刻音色"}
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
                选择 10–300 秒的清晰人声片段，上传后可以自由裁剪。
              </li>
              <li className="border-l-2 border-primary/30 pl-3">
                只保留一个人的正常说话声，不要上传歌曲、背景音乐或多人对话。
              </li>
              <li className="border-l-2 border-primary/30 pl-3">
                支持 MP3、M4A 和 WAV 格式，创建完成后会自动生成试听。
              </li>
              <li className="border-l-2 border-primary/30 pl-3">
                创建成功的音色会立即出现在“语音合成”的音色列表中。
              </li>
            </ul>
            <div className="mt-6 rounded-2xl border border-zinc-200 bg-white/70 p-4 dark:border-zinc-800 dark:bg-zinc-950/50">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs text-zinc-500">已保存音色</p>
                  <p className="mt-1 text-2xl font-semibold tracking-tight">{voices.length}<span className="ml-1 text-sm font-normal text-zinc-400">/ {MINIMAX_CUSTOM_VOICE_MAX_COUNT}</span></p>
                </div>
                <Mic2 className="h-7 w-7 text-primary/50" />
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="minimax-my-voices-title">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 id="minimax-my-voices-title" className="text-base font-semibold">我的音色</h2>
            <p className="mt-1 text-sm text-zinc-500">试听创建结果，管理名称和试听音频。</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setActionError("");
              onRefresh();
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
                const busy = deletingId === voice.id;
                const cloneModel = MINIMAX_AUDIO_MODELS.find((item) => item.id === voice.cloneModel);
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
                            <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 text-xs font-medium text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              可用
                            </span>
                          </div>
                          <p className="mt-1 text-xs leading-5 text-zinc-500">音色已经可以用于语音合成。</p>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                            {cloneModel ? <span>{cloneModel.label}</span> : null}
                            <span>{voice.noiseReduction ? "已开启降噪" : "原始噪声"}</span>
                            <span>{voice.volumeNormalization ? "已统一音量" : "原始音量"}</span>
                            {voice.sampleFileName ? <span className="max-w-[220px] truncate">{voice.sampleFileName}</span> : null}
                            <span>创建于 {formatDate(voice.createdAt)}</span>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
                        <button
                          type="button"
                          onClick={() => openRenameDialog(voice)}
                          disabled={voiceActionActive}
                          aria-label={`修改 ${voice.displayName} 的名称`}
                          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 px-2 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 sm:px-3"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">改名</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(voice)}
                          disabled={voiceActionActive}
                          aria-label={`删除 ${voice.displayName}`}
                          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 px-2 text-xs font-medium text-zinc-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:border-zinc-700 sm:px-3"
                        >
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <Trash2 className="h-3.5 w-3.5" />}
                          <span className="hidden sm:inline">删除</span>
                        </button>
                      </div>
                    </div>

                    {voice.demoAudioUrl ? (
                      <audio
                        controls
                        preload="metadata"
                        src={voice.demoAudioUrl}
                        className="mt-3 h-10 w-full"
                        aria-label={`${voice.displayName} 的试听音频`}
                      >
                        你的浏览器不支持音频播放。
                      </audio>
                    ) : null}
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
            key={`${dialog.kind}-${dialog.voice.id}`}
            dialog={dialog}
            submitting={dialogSubmitting}
            error={dialogError}
            onClose={() => {
              if (!dialogSubmitting) setDialog(null);
            }}
            onSubmit={handleDialogSubmit}
            nameMaxLength={MINIMAX_VOICE_DISPLAY_NAME_MAX_LENGTH}
            validateFile={validateSampleFile}
          />
        ) : null}
      </AnimatePresence>

      <MediaConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="删除复刻音色"
        message={`确定删除“${deleteTarget?.displayName || ""}”吗？云端音色和本地试听都会被彻底删除，无法恢复。`}
        confirmText="彻底删除"
        danger
      />
    </div>
  );
}
