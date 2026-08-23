"use client";

import { useCallback, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  FileAudio2,
  Loader2,
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
import { DOUBAO_CUSTOM_VOICE_MAX_COUNT } from "@/lib/media/shared/doubaoAudio";

const SAMPLE_ACCEPT = ".mp3,.m4a,.wav,audio/mpeg,audio/mp4,audio/wav";
const SAMPLE_EXTENSIONS = new Set(["mp3", "m4a", "wav"]);
const DISPLAY_NAME_MAX_LENGTH = 40;

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

function formatSampleRate(value) {
  const kilohertz = Number(value) / 1000;
  return `${Number.isInteger(kilohertz) ? kilohertz : kilohertz.toFixed(1)} kHz`;
}

function formatSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) return "";
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export default function DoubaoVoiceLibraryPanel({
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
  const [sampleFile, setSampleFile] = useState(null);
  const [sampleState, setSampleState] = useState(null);
  const [sampleInputKey, setSampleInputKey] = useState(0);
  const [consent, setConsent] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");
  const [actionError, setActionError] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [dialogSubmitting, setDialogSubmitting] = useState(false);
  const [dialogError, setDialogError] = useState("");

  const atLimit = voices.length >= DOUBAO_CUSTOM_VOICE_MAX_COUNT;
  const formDisabled = loading || creating || atLimit;
  const voiceActionActive = creating || Boolean(deletingId);

  const resetSample = useCallback(() => {
    setSampleFile(null);
    setSampleState(null);
    setSampleInputKey((current) => current + 1);
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    setFormError("");
    if (loading) return setFormError("声音列表正在读取，请稍后再保存");
    const name = displayName.trim();
    if (!name) return setFormError("请填写声音名称");
    const sampleError = validateSampleFile(sampleFile);
    if (sampleError) return setFormError(sampleError);
    if (sampleState?.status !== "ready" || !sampleState.upload?.fileId) {
      return setFormError(sampleState?.error || "请等待声音样本上传和识别完成");
    }
    const clipDuration = sampleState.clipEnd - sampleState.clipStart;
    if (clipDuration < 1 || clipDuration > 30) return setFormError("请选择 1 至 30 秒的清晰人声片段");
    if (!consent) return setFormError("请先确认声音授权");
    if (atLimit) return setFormError(`最多只能保存 ${DOUBAO_CUSTOM_VOICE_MAX_COUNT} 个声音`);

    setCreating(true);
    try {
      await onCreate({
        displayName: name,
        sampleUploadId: sampleState.upload.fileId,
        clipStart: sampleState.clipStart,
        clipEnd: sampleState.clipEnd,
        consent: true,
      });
      setDisplayName("");
      setConsent(false);
      resetSample();
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : "保存声音失败";
      setFormError(`${message}。请重新选择声音样本`);
      resetSample();
    } finally {
      setCreating(false);
    }
  };

  const submitRename = async (input) => {
    const name = input.displayName.trim();
    if (!name) {
      setDialogError("请填写声音名称");
      return;
    }
    setDialogSubmitting(true);
    setDialogError("");
    try {
      await onRename(dialog.voice, name);
      setDialog(null);
    } catch (renameError) {
      setDialogError(renameError instanceof Error ? renameError.message : "修改声音名称失败");
    } finally {
      setDialogSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    const voice = deleteTarget;
    setDeleteTarget(null);
    if (!voice) return;
    setDeletingId(voice.profileId);
    setActionError("");
    try {
      await onDelete(voice);
    } catch (deleteError) {
      setActionError(deleteError instanceof Error ? deleteError.message : "删除声音失败");
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
                <h2 className="text-lg font-semibold">添加参考声音</h2>
                <p className="mt-1 text-sm leading-6 text-zinc-500">上传一段清晰人声并选择要使用的片段，保存后即可用于语音合成。</p>
              </div>
            </div>

            <form onSubmit={submit} className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="doubao-voice-name" className="text-sm font-medium">声音名称</label>
                <input
                  id="doubao-voice-name"
                  value={displayName}
                  onChange={(event) => {
                    setDisplayName(event.target.value);
                    setFormError("");
                  }}
                  maxLength={DISPLAY_NAME_MAX_LENGTH}
                  placeholder="例如：温柔旁白"
                  disabled={formDisabled}
                  className="focus-ring h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </div>

              <div className="space-y-2">
                <span className="text-sm font-medium">声音样本</span>
                {sampleFile ? (
                  <AudioSourceClipField
                    key={`doubao-voice-source-${sampleInputKey}`}
                    file={sampleFile}
                    purpose={AUDIO_UPLOAD_PURPOSES.DOUBAO_VOICE_LIBRARY}
                    label="声音样本"
                    disabled={formDisabled}
                    onStateChange={setSampleState}
                    onRemove={resetSample}
                  />
                ) : (
                  <AudioFilePicker
                    id="doubao-voice-sample"
                    inputKey={sampleInputKey}
                    disabled={formDisabled}
                    accept={SAMPLE_ACCEPT}
                    hint="支持 MP3、M4A 或 WAV，选择 1 至 30 秒的清晰人声"
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

              <label className="flex items-start gap-3 rounded-xl border border-zinc-200 p-4 text-sm leading-6 dark:border-zinc-700">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                  disabled={formDisabled}
                  className="mt-1 h-4 w-4 shrink-0 accent-primary"
                />
                <span className="text-zinc-600 dark:text-zinc-300">我确认已获得该声音本人明确授权，并同意将这段样本用于语音合成。</span>
              </label>

              <AudioFormError message={formError} />
              {atLimit ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700" role="status">
                  已保存 {DOUBAO_CUSTOM_VOICE_MAX_COUNT} 个声音。删除不再使用的声音后，才能继续添加。
                </div>
              ) : null}

              <button
                type="submit"
                disabled={formDisabled || (sampleFile && sampleState?.status !== "ready")}
                className="btn-primary inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl font-medium disabled:opacity-60"
              >
                {creating ? <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" /> : <FileAudio2 className="h-5 w-5" />}
                {creating ? "正在保存声音…" : "保存到声音库"}
              </button>
            </form>
          </div>

          <aside className="border-t border-zinc-200/70 bg-zinc-50/60 p-5 dark:border-zinc-800 dark:bg-zinc-900/40 sm:p-6 lg:border-l lg:border-t-0">
            <div className="flex items-center gap-2 text-primary">
              <ShieldCheck className="h-5 w-5" />
              <h3 className="text-sm font-semibold">样本准备要点</h3>
            </div>
            <ul className="mt-4 space-y-4 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
              <li className="border-l-2 border-primary/30 pl-3">选择 1–30 秒的清晰人声片段，上传后可以精确裁剪。</li>
              <li className="border-l-2 border-primary/30 pl-3">只保留一个人的正常说话声，不要上传歌曲、背景音乐或多人对话。</li>
              <li className="border-l-2 border-primary/30 pl-3">声音保存成功后会立即出现在语音合成的声音列表中。</li>
            </ul>
            <div className="mt-6 rounded-2xl border border-zinc-200 bg-white/70 p-4 dark:border-zinc-800 dark:bg-zinc-950/50">
              <p className="text-xs text-zinc-500">已保存声音</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">{voices.length}<span className="ml-1 text-sm font-normal text-zinc-400">/ {DOUBAO_CUSTOM_VOICE_MAX_COUNT}</span></p>
            </div>
          </aside>
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="doubao-my-voices-title">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 id="doubao-my-voices-title" className="text-base font-semibold">我的声音</h2>
            <p className="mt-1 text-sm text-zinc-500">试听和管理已保存的参考声音。</p>
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
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} />刷新
          </button>
        </div>

        <AudioFormError message={actionError || error} />
        {loading ? (
          <div className="space-y-3" aria-label="正在读取我的声音" aria-busy="true">
            {[0, 1].map((item) => <div key={item} className="h-32 animate-pulse rounded-2xl border border-zinc-200/70 bg-zinc-100/60 motion-reduce:animate-none dark:border-zinc-800 dark:bg-zinc-900/60" />)}
          </div>
        ) : voices.length === 0 ? (
          <div className="flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200/80 bg-white/60 px-6 text-center dark:border-zinc-800 dark:bg-zinc-950/50">
            <FileAudio2 className="h-7 w-7 text-primary" />
            <p className="mt-4 text-sm font-medium text-zinc-700 dark:text-zinc-200">还没有参考声音</p>
            <p className="mt-1 text-xs leading-5 text-zinc-500">在上方上传声音样本，保存后会显示在这里。</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <AnimatePresence initial={false}>
              {voices.map((voice) => {
                const busy = deletingId === voice.profileId;
                return (
                  <motion.article
                    key={voice.profileId}
                    layout={reduceMotion ? false : "position"}
                    initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
                    className="rounded-2xl border border-zinc-200/70 bg-white/80 p-4 dark:border-zinc-800/70 dark:bg-zinc-950/70"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100">{voice.displayName}</h3>
                        <p className="mt-1 truncate text-xs text-zinc-500">{voice.sampleFileName}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setDialogError("");
                            setDialog({ kind: "rename", voice });
                          }}
                          disabled={voiceActionActive}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                          aria-label={`重命名 ${voice.displayName}`}
                          title="重命名"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(voice)}
                          disabled={voiceActionActive}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:border-zinc-700"
                          aria-label={`删除 ${voice.displayName}`}
                          title="删除"
                        >
                          {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Trash2 className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                    <audio controls preload="metadata" src={voice.audioUrl} className="mt-3 h-10 w-full" aria-label={`${voice.displayName} 的试听音频`}>
                      你的浏览器不支持音频播放。
                    </audio>
                    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
                      <span>{Number(voice.duration).toFixed(1)} 秒</span>
                      <span>{formatSampleRate(voice.sampleRate)}</span>
                      {formatSize(voice.size) ? <span>{formatSize(voice.size)}</span> : null}
                      <span>{formatDate(voice.createdAt)}</span>
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
            dialog={dialog}
            submitting={dialogSubmitting}
            error={dialogError}
            onClose={() => {
              if (!dialogSubmitting) setDialog(null);
            }}
            onSubmit={submitRename}
            nameMaxLength={DISPLAY_NAME_MAX_LENGTH}
          />
        ) : null}
      </AnimatePresence>

      <MediaConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="删除声音"
        message={`确定删除“${deleteTarget?.displayName || ""}”吗？删除后无法恢复，也不能再用于新的语音合成。`}
        confirmText="删除"
        danger
      />
    </div>
  );
}
