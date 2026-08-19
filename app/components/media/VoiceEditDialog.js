"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Loader2, X } from "lucide-react";
import AudioFilePicker from "@/app/components/media/AudioFilePicker";
import AudioSourceClipField from "@/app/components/media/AudioSourceClipField";

export default function VoiceEditDialog({
  dialog,
  submitting,
  error,
  onClose,
  onSubmit,
  uploadPurpose,
  uploadAccept,
  nameMaxLength = 40,
  validateFile,
}) {
  const reduceMotion = useReducedMotion();
  const onCloseRef = useRef(onClose);
  const submittingRef = useRef(submitting);
  const formRef = useRef(null);
  const firstInputRef = useRef(null);
  const [displayName, setDisplayName] = useState(dialog.voice.displayName);
  const [audio, setAudio] = useState(null);
  const [audioSource, setAudioSource] = useState(null);
  const [selectionError, setSelectionError] = useState("");
  const [consent, setConsent] = useState(false);

  useEffect(() => {
    onCloseRef.current = onClose;
    submittingRef.current = submitting;
  }, [onClose, submitting]);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => firstInputRef.current?.focus(), 0);
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !submittingRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key === "Tab") {
        const focusable = Array.from(formRef.current?.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) || []).filter((element) => element.getAttribute("aria-hidden") !== "true");
        if (focusable.length === 0) {
          event.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (!formRef.current?.contains(active)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        } else if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, []);

  const submitDialog = (event) => {
    event.preventDefault();
    if (dialog.kind === "rename") {
      onSubmit({ displayName: displayName.trim() });
      return;
    }
    onSubmit({
      displayName: displayName.trim(),
      audio,
      audioSource,
      consent,
    });
  };

  return (
    <motion.div
      className="fixed inset-0 z-[72] flex items-end justify-center sm:items-center sm:p-4"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-zinc-950/45 backdrop-blur-sm"
        onClick={submitting ? undefined : onClose}
        aria-label="关闭编辑音色窗口"
        tabIndex={-1}
      />
      <motion.form
        ref={formRef}
        onSubmit={submitDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-dialog-title"
        initial={reduceMotion ? false : { opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.98 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-[28px] border border-zinc-200 bg-white p-5 shadow-pop sm:rounded-[28px] sm:p-6 dark:border-zinc-800 dark:bg-zinc-950"
      >
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
          aria-label="关闭"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="pr-10">
          <h3 id="voice-dialog-title" className="text-lg font-semibold">
            {dialog.kind === "rename" ? "修改音色名称" : "更换声音样本"}
          </h3>
          <p className="mt-1 text-sm leading-6 text-zinc-500">
            {dialog.kind === "rename"
              ? "名称只用于你自己的音色列表，不会改变声音效果。"
              : "提交新样本后会重新制作，在完成前暂时不能用于合成。"}
          </p>
        </div>

        <div className="mt-5 space-y-4">
          <div className="space-y-2">
            <label htmlFor="voice-edit-name" className="text-sm font-medium">音色名称</label>
            <input
              ref={firstInputRef}
              id="voice-edit-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={nameMaxLength}
              required
              className="focus-ring h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>

          {dialog.kind === "replace" ? (
            <>
              <div className="space-y-2">
                <span className="text-sm font-medium">新声音样本</span>
                {audio ? (
                  <AudioSourceClipField
                    key={`replacement-source-${dialog.uploadRevision || 0}`}
                    file={audio}
                    purpose={uploadPurpose}
                    label="新声音样本"
                    disabled={submitting}
                    onStateChange={setAudioSource}
                    onRemove={() => {
                      setAudio(null);
                      setAudioSource(null);
                      setSelectionError("");
                    }}
                  />
                ) : (
                  <AudioFilePicker
                    id="replacement-audio"
                    inputKey={`${dialog.kind}-${dialog.voice.id}`}
                    disabled={submitting}
                    accept={uploadAccept}
                    onChange={(file) => {
                      const fileError = validateFile(file);
                      if (fileError) {
                        setSelectionError(fileError);
                        return;
                      }
                      setAudio(file);
                      setAudioSource(null);
                      setSelectionError("");
                    }}
                    compact
                  />
                )}
              </div>
              <label className="flex items-start gap-3 rounded-xl border border-zinc-200 p-3 text-sm leading-6 dark:border-zinc-700">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                  className="mt-1 h-4 w-4 shrink-0 accent-primary"
                />
                <span className="text-zinc-600 dark:text-zinc-300">
                  我确认已获得该声音本人明确授权，并同意将样本用于创建复刻音色。
                </span>
              </label>
              {selectionError ? <p className="text-xs text-red-600" role="alert">{selectionError}</p> : null}
            </>
          ) : null}

          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600" role="alert">
              {error}
            </div>
          ) : null}
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="h-11 rounded-xl bg-zinc-100 text-sm font-medium text-zinc-700 transition-[background-color,transform] hover:bg-zinc-200 active:scale-[0.98] disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-200"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={submitting || (dialog.kind === "replace" && audioSource?.status !== "ready")}
            className="btn-primary inline-flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-medium disabled:opacity-60"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : null}
            {submitting ? "正在保存…" : (dialog.kind === "rename" ? "保存名称" : "重新制作")}
          </button>
        </div>
      </motion.form>
    </motion.div>
  );
}
