"use client";

import { useI18n } from "@/lib/client/i18n";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, FileText, Loader2, Paperclip, Square, X } from "lucide-react";
import { deleteTemporaryFile, uploadPrivateFile } from "@/lib/client/uploadFile";
import { getAttachmentAcceptForModel, getAttachmentCategory, getAttachmentLimits, getFileExtension, isSupportedUploadExtension, MAX_CHAT_ATTACHMENTS } from "@/lib/shared/attachments";
import { formatAttachmentMeta } from "@/lib/shared/messageAttachments";

const attachmentAccept = getAttachmentAcceptForModel({ supportsImages: true, supportsDocuments: true });

export default function Composer({ scopeKey, ...props }) {
  return <ComposerDraft key={scopeKey} {...props} />;
}

function ComposerDraft({ loading, isStreaming, isWaitingForAI, onSend, onStop }) {
  const { t, locale, formatNumber, localizeMessage } = useI18n();
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [operation, setOperation] = useState("");
  const [uploadName, setUploadName] = useState("");
  const [error, setError] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const uploadControllerRef = useRef(null);
  const operationLock = useRef(false);
  const canStop = isStreaming || isWaitingForAI;
  const busy = loading || Boolean(operation);

  useEffect(() => () => uploadControllerRef.current?.abort(), []);

  useEffect(() => {
    const setAppHeight = () => {
      const viewport = window.visualViewport;
      document.documentElement.style.setProperty("--app-height", isFocused ? `${Math.round(viewport?.height ?? window.innerHeight)}px` : "100dvh");
      document.documentElement.style.setProperty("--app-offset-top", isFocused ? `${Math.round(viewport?.offsetTop ?? 0)}px` : "0px");
    };
    setAppHeight();
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", setAppHeight);
    viewport?.addEventListener("scroll", setAppHeight);
    window.addEventListener("resize", setAppHeight);
    return () => {
      viewport?.removeEventListener("resize", setAppHeight);
      viewport?.removeEventListener("scroll", setAppHeight);
      window.removeEventListener("resize", setAppHeight);
      document.documentElement.style.removeProperty("--app-height");
      document.documentElement.style.removeProperty("--app-offset-top");
    };
  }, [isFocused]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const height = textarea.scrollHeight;
    textarea.style.height = `${Math.min(height, 160)}px`;
    textarea.style.overflowY = height > 160 ? "auto" : "hidden";
  }, [input]);

  const addAttachments = async files => {
    if (loading || operationLock.current || !files.length) return;
    setError("");
    if (attachments.length + files.length > MAX_CHAT_ATTACHMENTS) {
      setError(t("每条消息最多添加 {count} 个附件", "Add up to {count} attachments per message", { count: formatNumber(MAX_CHAT_ATTACHMENTS) }));
      return;
    }
    for (const file of files) {
      const extension = getFileExtension(file.name);
      const category = getAttachmentCategory({ extension, mimeType: file.type });
      if (!isSupportedUploadExtension(extension) || !["image", "document"].includes(category)) {
        setError(t("请选择图片或 PDF、Word、Excel、CSV、TXT、Markdown 文档", "Choose an image or a PDF, Word, Excel, CSV, TXT, or Markdown file."));
        return;
      }
      if (file.size <= 0 || file.size > getAttachmentLimits(category).maxBytes) {
        setError(t("{name}：请选择有内容且大小在 20 MB 以内的文件", "{name}: Choose a non-empty file up to 20 MB", { name: file.name }));
        return;
      }
    }
    operationLock.current = true;
    const controller = new AbortController();
    uploadControllerRef.current = controller;
    setOperation("upload");
    try {
      for (const file of files) {
        if (controller.signal.aborted) return;
        setUploadName(file.name);
        const uploaded = await uploadPrivateFile(file, { kind: "chat", signal: controller.signal });
        if (controller.signal.aborted) return;
        setAttachments(current => [...current, uploaded]);
      }
    } catch (error) { if (!controller.signal.aborted) setError(error.message); }
    finally {
      operationLock.current = false;
      uploadControllerRef.current = null;
      if (!controller.signal.aborted) { setOperation(""); setUploadName(""); }
    }
  };

  const removeAttachment = async fileId => {
    if (loading || operationLock.current) return;
    operationLock.current = true; setOperation("remove"); setError("");
    try {
      if (!await deleteTemporaryFile(fileId)) throw new Error(t("移除附件失败，请重试", "Could not remove the attachment. Please try again."));
      setAttachments(current => current.filter(file => file.fileId !== fileId));
    } catch (error) { setError(error.message); }
    finally { operationLock.current = false; setOperation(""); }
  };

  const handleSend = async () => {
    const text = input.trim();
    if ((!text && !attachments.length) || loading || operationLock.current) return;
    operationLock.current = true; setOperation("send"); setError("");
    const sentIds = new Set(attachments.map(file => file.fileId));
    try {
      const sent = await onSend({ text, attachments });
      if (sent === true) {
        setInput(current => current.trim() === text ? "" : current);
        setAttachments(current => current.filter(file => !sentIds.has(file.fileId)));
      }
    } catch (error) { setError(error.message); }
    finally { operationLock.current = false; setOperation(""); }
  };

  const handleKeyDown = event => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey && !/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="max-w-4xl mx-auto w-full relative">
      <div
        className="composer-shell relative p-3 md:p-4 glass-effect rounded-[24px] border-zinc-200/60 dark:border-zinc-800/60 hover:border-zinc-300 dark:hover:border-zinc-700"
        onDragOver={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = busy ? "none" : "copy"; } }}
        onDrop={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); void addAttachments(Array.from(event.dataTransfer.files)); } }}
      >
        {attachments.length > 0 && <ul aria-label={t("待发送附件", "Attachments to send")} className="flex gap-2 overflow-x-auto pb-2">
          {attachments.map(file => <li key={file.fileId} className="flex w-52 shrink-0 items-center gap-2 rounded-xl border border-zinc-200 bg-white/70 p-2 dark:border-zinc-700 dark:bg-zinc-900/60">
            <a href={file.url} target="_blank" rel="noreferrer" aria-label={t("预览 {name}", "Preview {name}", { name: file.name })} className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-800">
              {file.category === "image" ? <Image src={file.url} alt={file.name} width={40} height={40} unoptimized className="h-full w-full object-cover" /> : <FileText size={20} />}
            </a>
            <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium" title={file.name}>{file.name}</p><p className="mt-1 text-[11px] text-zinc-500">{formatAttachmentMeta(file, locale)}</p></div>
            <button type="button" disabled={busy} aria-label={t("移除 {name}", "Remove {name}", { name: file.name })} onClick={() => void removeAttachment(file.fileId)} className="rounded-full p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"><X size={14} /></button>
          </li>)}
        </ul>}
        <div className="flex items-end gap-2">
        <input ref={fileInputRef} type="file" multiple accept={attachmentAccept} aria-label={t("选择图片或附件", "Choose images or attachments")} className="hidden" disabled={busy || attachments.length >= MAX_CHAT_ATTACHMENTS} onChange={event => { const files = Array.from(event.target.files); event.target.value = ""; void addAttachments(files); }} />
        <button type="button" aria-label={t("上传图片或附件", "Upload images or attachments")} title={t("上传图片或附件，最多 5 个，每个 20 MB", "Upload up to 5 images or attachments, 20 MB each")} disabled={busy || attachments.length >= MAX_CHAT_ATTACHMENTS} onClick={() => fileInputRef.current.click()} className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-primary disabled:opacity-40 dark:hover:bg-zinc-800">
          {operation === "upload" ? <Loader2 size={19} className="animate-spin" /> : <Paperclip size={19} />}
        </button>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={event => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={event => { if (event.clipboardData.files.length) { event.preventDefault(); void addAttachments(Array.from(event.clipboardData.files)); } }}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          aria-label={t("消息", "Message")}
          placeholder={t("输入问题或描述任务，也可以添加文件…", "Ask a question, describe a task, or attach files…")}
          className="flex-1 min-w-0 bg-transparent border-none outline-none focus:ring-0 text-base md:text-[15px] text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 resize-none py-2 min-h-[44px] transition-all no-scrollbar"
          rows={1}
        />
        <button
          onClick={canStop ? onStop : handleSend}
          disabled={!canStop && (busy || (!input.trim() && !attachments.length))}
          className={`mb-0.5 flex shrink-0 items-center justify-center w-9 h-9 rounded-full transition-all duration-200 active:scale-90 disabled:cursor-not-allowed ${canStop
            ? "bg-red-500 hover:bg-red-600 text-white shadow-soft"
            : "btn-primary disabled:bg-zinc-200 dark:disabled:bg-zinc-800 disabled:text-zinc-400 dark:disabled:text-zinc-600 disabled:shadow-none"}`}
          type="button"
          aria-label={canStop ? t("停止生成", "Stop generating") : t("发送", "Send")}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={canStop ? "stop" : "send"}
              initial={{ scale: 0.4, opacity: 0, rotate: -90 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              exit={{ scale: 0.4, opacity: 0, rotate: 90 }}
              transition={{ duration: 0.15 }}
              className="flex items-center justify-center"
            >
              {canStop ? <Square size={18} fill="currentColor" /> : <ArrowUp size={18} strokeWidth={2.5} />}
            </motion.span>
          </AnimatePresence>
        </button>
        </div>
        {operation === "upload" && <p role="status" className="mt-2 truncate text-xs text-zinc-500">{t("正在上传 {name}…", "Uploading {name}…", { name: uploadName })}</p>}
        {error && <p role="alert" className="mt-2 text-xs text-red-500">{localizeMessage(error)}</p>}
      </div>
    </div>
  );
}
