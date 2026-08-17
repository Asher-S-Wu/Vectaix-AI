"use client";

import { useRef, useState } from "react";
import {
  CircleAlert,
  Edit3,
  FileAudio2,
  Loader2,
  Mic2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import AudioSourceClipField from "@/app/components/media/AudioSourceClipField";
import MediaConfirmDialog from "@/app/components/media/MediaConfirmDialog";
import { AUDIO_UPLOAD_PURPOSES } from "@/lib/media/shared/audioUploads";
import {
  MINIMAX_AUDIO_DEFAULT_MODEL,
  MINIMAX_AUDIO_LANGUAGE_OPTIONS,
  MINIMAX_AUDIO_MODELS,
  MINIMAX_CUSTOM_VOICE_MAX_COUNT,
  MINIMAX_VOICE_DEMO_TEXT_MAX_LENGTH,
  MINIMAX_VOICE_DISPLAY_NAME_MAX_LENGTH,
} from "@/lib/media/shared/minimaxAudio";

const SAMPLE_ACCEPT = ".mp3,.m4a,.wav,audio/mpeg,audio/mp4,audio/wav";
const SAMPLE_EXTENSIONS = new Set(["mp3", "m4a", "wav"]);

function extension(name) {
  return String(name || "").split(".").pop()?.toLowerCase() || "";
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
  const inputRef = useRef(null);
  const [displayName, setDisplayName] = useState("");
  const [demoText, setDemoText] = useState("你好，这是我在 MiniMax 创建的专属声音。很高兴认识你！");
  const [model, setModel] = useState(MINIMAX_AUDIO_DEFAULT_MODEL);
  const [languageBoost, setLanguageBoost] = useState("auto");
  const [noiseReduction, setNoiseReduction] = useState(true);
  const [volumeNormalization, setVolumeNormalization] = useState(true);
  const [consent, setConsent] = useState(false);
  const [sampleFile, setSampleFile] = useState(null);
  const [sampleState, setSampleState] = useState(null);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editingName, setEditingName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);

  const chooseFile = (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    if (!file) return;
    if (!SAMPLE_EXTENSIONS.has(extension(file.name))) {
      setFormError("声音样本只支持 MP3、M4A 或 WAV 文件");
      return;
    }
    setSampleFile(file);
    setSampleState(null);
    setFormError("");
  };

  const removeSample = () => {
    setSampleFile(null);
    setSampleState(null);
  };

  const submit = async (event) => {
    event.preventDefault();
    setFormError("");
    const name = displayName.trim();
    const text = demoText.trim();
    if (!name) return setFormError("请填写音色名称");
    if (name.length > MINIMAX_VOICE_DISPLAY_NAME_MAX_LENGTH) {
      return setFormError(`音色名称最多支持 ${MINIMAX_VOICE_DISPLAY_NAME_MAX_LENGTH} 个字符`);
    }
    if (!text) return setFormError("请填写试听文案");
    if (text.length > MINIMAX_VOICE_DEMO_TEXT_MAX_LENGTH) {
      return setFormError(`试听文案最多支持 ${MINIMAX_VOICE_DEMO_TEXT_MAX_LENGTH} 个字符`);
    }
    if (!sampleFile || sampleState?.status !== "ready" || !sampleState.upload) {
      return setFormError("请等待声音样本上传并读取完成");
    }
    const clipDuration = sampleState.clipEnd - sampleState.clipStart;
    if (clipDuration < 10 || clipDuration > 300) {
      return setFormError("请选择 10 至 300 秒的声音片段");
    }
    if (!consent) return setFormError("请确认你有权使用这段声音进行复刻");
    setCreating(true);
    try {
      await onCreate({
        displayName: name,
        sampleUploadId: sampleState.upload.fileId,
        clipStart: sampleState.clipStart,
        clipEnd: sampleState.clipEnd,
        demoText: text,
        model,
        languageBoost,
        noiseReduction,
        volumeNormalization,
        consent: true,
      });
      setDisplayName("");
      setSampleFile(null);
      setSampleState(null);
      setConsent(false);
    } catch (createError) {
      setFormError(createError instanceof Error ? createError.message : "声音复刻失败");
    } finally {
      setCreating(false);
    }
  };

  const beginRename = (voice) => {
    setEditingId(voice.id);
    setEditingName(voice.displayName);
    setFormError("");
  };

  const saveRename = async (voice) => {
    const name = editingName.trim();
    if (!name) return setFormError("请填写音色名称");
    if (name.length > MINIMAX_VOICE_DISPLAY_NAME_MAX_LENGTH) {
      return setFormError(`音色名称最多支持 ${MINIMAX_VOICE_DISPLAY_NAME_MAX_LENGTH} 个字符`);
    }
    setSavingName(true);
    try {
      await onRename(voice, name);
      setEditingId("");
      setEditingName("");
    } catch (renameError) {
      setFormError(renameError instanceof Error ? renameError.message : "修改音色失败");
    } finally {
      setSavingName(false);
    }
  };

  const confirmDelete = async () => {
    const voice = deleteTarget;
    setDeleteTarget(null);
    if (!voice) return;
    setDeletingId(voice.id);
    setFormError("");
    try {
      await onDelete(voice);
    } catch (deleteError) {
      setFormError(deleteError instanceof Error ? deleteError.message : "删除音色失败");
    } finally {
      setDeletingId("");
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">音色名称</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={MINIMAX_VOICE_DISPLAY_NAME_MAX_LENGTH}
              placeholder="例如：温柔旁白"
              disabled={creating}
              className="focus-ring h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">试听模型</span>
            <select
              value={model}
              onChange={(event) => setModel(event.target.value)}
              disabled={creating}
              className="focus-ring h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              {MINIMAX_AUDIO_MODELS.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.price}</option>)}
            </select>
          </label>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">声音样本</p>
              <p className="mt-0.5 text-xs text-zinc-500">上传 MP3、M4A 或 WAV，并选择 10 至 300 秒的清晰人声。</p>
            </div>
            {!sampleFile ? (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={creating}
                className="focus-ring inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:border-primary/40 hover:text-primary dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
              >
                <FileAudio2 className="h-4 w-4" />
                选择音频
              </button>
            ) : null}
          </div>
          <input ref={inputRef} type="file" accept={SAMPLE_ACCEPT} onChange={chooseFile} className="hidden" />
          {sampleFile ? (
            <AudioSourceClipField
              file={sampleFile}
              purpose={AUDIO_UPLOAD_PURPOSES.MINIMAX_VOICE_CLONE}
              label="复刻样本"
              disabled={creating}
              onStateChange={setSampleState}
              onRemove={removeSample}
            />
          ) : (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="focus-ring flex min-h-28 w-full flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 px-5 text-center hover:border-primary/50 dark:border-zinc-700"
            >
              <Mic2 className="h-6 w-6 text-primary" />
              <span className="mt-2 text-sm font-medium">上传一段只有目标人物说话的音频</span>
              <span className="mt-1 text-xs text-zinc-500">安静、无配乐的样本通常效果更好</span>
            </button>
          )}
        </div>

        <label className="block space-y-2">
          <span className="flex items-center justify-between gap-3 text-sm font-medium text-zinc-700 dark:text-zinc-200">
            试听文案
            <span className="text-xs font-normal text-zinc-400">{demoText.length}/{MINIMAX_VOICE_DEMO_TEXT_MAX_LENGTH}</span>
          </span>
          <textarea
            value={demoText}
            onChange={(event) => setDemoText(event.target.value)}
            maxLength={MINIMAX_VOICE_DEMO_TEXT_MAX_LENGTH}
            rows={3}
            disabled={creating}
            className="focus-ring w-full resize-y rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm leading-6 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-3">
          <label className="space-y-2">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">语言增强</span>
            <select
              value={languageBoost}
              onChange={(event) => setLanguageBoost(event.target.value)}
              disabled={creating}
              className="focus-ring h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              {MINIMAX_AUDIO_LANGUAGE_OPTIONS.map((item) => <option key={item.id || "none"} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white/60 px-3 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-900/60">
            <input type="checkbox" checked={noiseReduction} onChange={(event) => setNoiseReduction(event.target.checked)} disabled={creating} className="h-4 w-4 accent-primary" />
            开启样本降噪
          </label>
          <label className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white/60 px-3 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-900/60">
            <input type="checkbox" checked={volumeNormalization} onChange={(event) => setVolumeNormalization(event.target.checked)} disabled={creating} className="h-4 w-4 accent-primary" />
            统一样本音量
          </label>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs leading-5 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
          创建时生成的试听会按试听文字正常计费；首次使用复刻音色正式合成时，阿里云会收取 9.9 元音色复刻费用。
        </div>

        <label className="flex items-start gap-3 text-sm text-zinc-600 dark:text-zinc-300">
          <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} disabled={creating} className="mt-0.5 h-4 w-4 accent-primary" />
          <span>我确认拥有这段声音的合法使用和复刻授权，并对生成内容负责。</span>
        </label>

        {formError || error ? (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{formError || error}</span>
          </div>
        ) : null}

        <button
          type="submit"
          disabled={creating || voices.length >= MINIMAX_CUSTOM_VOICE_MAX_COUNT}
          className="focus-ring inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic2 className="h-4 w-4" />}
          {creating ? "正在复刻并生成试听…" : "创建复刻音色"}
        </button>
      </form>

      <section className="space-y-3 border-t border-zinc-200/70 pt-5 dark:border-zinc-800/70">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">我的 MiniMax 音色</h2>
            <p className="mt-1 text-xs text-zinc-500">{voices.length}/{MINIMAX_CUSTOM_VOICE_MAX_COUNT} 个，仅你自己可以查看和使用。</p>
          </div>
          <button type="button" onClick={onRefresh} disabled={loading} className="focus-ring rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 hover:text-primary dark:hover:bg-zinc-800" aria-label="刷新音色列表">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {loading ? (
          <div className="flex min-h-24 items-center justify-center text-sm text-zinc-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在读取音色</div>
        ) : !voices.length ? (
          <div className="rounded-xl border border-dashed border-zinc-300 px-5 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700">还没有复刻音色，完成首次创建后会显示在这里。</div>
        ) : (
          <div className="space-y-3">
            {voices.map((voice) => (
              <article key={voice.id} className="rounded-xl border border-zinc-200 bg-white/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/60">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {editingId === voice.id ? (
                      <div className="flex gap-2">
                        <input value={editingName} onChange={(event) => setEditingName(event.target.value)} maxLength={MINIMAX_VOICE_DISPLAY_NAME_MAX_LENGTH} className="focus-ring h-9 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
                        <button type="button" onClick={() => saveRename(voice)} disabled={savingName} className="focus-ring rounded-lg bg-primary px-3 text-xs font-semibold text-white">保存</button>
                        <button type="button" onClick={() => setEditingId("")} disabled={savingName} className="focus-ring rounded-lg border border-zinc-200 px-3 text-xs dark:border-zinc-700">取消</button>
                      </div>
                    ) : (
                      <>
                        <h3 className="truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100">{voice.displayName}</h3>
                        <p className="mt-1 truncate font-mono text-[11px] text-zinc-400">{voice.voiceId}</p>
                      </>
                    )}
                  </div>
                  {editingId !== voice.id ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <button type="button" onClick={() => beginRename(voice)} disabled={Boolean(deletingId)} className="focus-ring rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 hover:text-primary dark:hover:bg-zinc-800" aria-label={`修改 ${voice.displayName} 的名称`}><Edit3 className="h-4 w-4" /></button>
                      <button type="button" onClick={() => setDeleteTarget(voice)} disabled={Boolean(deletingId)} className="focus-ring rounded-lg p-2 text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30" aria-label={`删除 ${voice.displayName}`}>
                        {deletingId === voice.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </button>
                    </div>
                  ) : null}
                </div>
                {voice.demoAudioUrl ? <audio controls preload="metadata" src={voice.demoAudioUrl} className="mt-3 h-9 w-full" aria-label={`${voice.displayName} 的试听音频`} /> : null}
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-400">
                  <span>{MINIMAX_AUDIO_MODELS.find((item) => item.id === voice.cloneModel)?.label}</span>
                  <span>{voice.noiseReduction ? "已降噪" : "原始噪声"}</span>
                  <span>{voice.volumeNormalization ? "已统一音量" : "原始音量"}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <MediaConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除复刻音色"
        message={`确定删除“${deleteTarget?.displayName || ""}”吗？阿里云上的音色和本地试听都会被彻底删除，无法恢复。`}
        confirmText="彻底删除"
        danger
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
