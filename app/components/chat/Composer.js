"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import NextImage from "next/image";
import {
  ArrowUp,
  FileText,
  Paperclip,
  Square,
  X,
} from "lucide-react";
import { deleteTemporaryFile, uploadPrivateFile } from "@/lib/client/uploadFile";
import { useToast } from "../common/ToastProvider";
import ModelSelector from "./ModelSelector";
import SettingsMenu from "../settings/SettingsMenu";
import {
  getModelAttachmentSupport,
} from "@/lib/shared/models";
import {
  getAttachmentInputType,
  getAttachmentAcceptForModel,
  getAttachmentLimits,
  IMAGE_MIME_TYPES,
  MAX_CHAT_ATTACHMENTS,
} from "@/lib/shared/attachments";
import { createLocalAttachment, isImageAttachment } from "@/lib/shared/messageAttachments";
import { convertImageFileToPng, readAsDataUrl } from "./composerFileUtils";

export default function Composer({
  loading,
  isStreaming,
  isWaitingForAI,
  model,
  modelReady,
  onModelChange,
  webSearch,
  setWebSearch,
  chatSystemPrompt,
  onChatSystemPromptSave,
  systemPrompts,
  addSystemPrompt,
  updateSystemPrompt,
  deleteSystemPrompt,
  onSend,
  onStop,
  prefill,
}) {
  const toast = useToast();
  const [input, setInput] = useState("");
  const [selectedAttachments, setSelectedAttachments] = useState([]);
  const [isMainInputFocused, setIsMainInputFocused] = useState(false);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const mountedRef = useRef(true);
  const discardedAttachmentIdsRef = useRef(new Set());
  const {
    supportsImages,
    supportsVideo,
    supportsAudio,
    supportsFilePicker,
  } = getModelAttachmentSupport(model);
  const attachmentAccept = getAttachmentAcceptForModel({
    supportsImages,
    supportsVideo,
    supportsAudio,
  });
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const setAppHeight = () => {
      const vv = window.visualViewport;
      if (isMainInputFocused) {
        document.documentElement.style.setProperty("--app-height", `${Math.round(vv?.height)}px`);
        document.documentElement.style.setProperty("--app-offset-top", `${Math.round(vv?.offsetTop)}px`);
      } else {
        document.documentElement.style.setProperty("--app-height", "100dvh");
        document.documentElement.style.setProperty("--app-offset-top", "0px");
      }
    };
    setAppHeight();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", setAppHeight);
    vv?.addEventListener("scroll", setAppHeight);
    window.addEventListener("resize", setAppHeight);
    return () => {
      vv?.removeEventListener("resize", setAppHeight);
      vv?.removeEventListener("scroll", setAppHeight);
      window.removeEventListener("resize", setAppHeight);
    };
  }, [isMainInputFocused]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const sh = el.scrollHeight;
    el.style.height = `${Math.min(sh, 160)}px`;
    el.style.overflowY = sh > 160 ? "auto" : "hidden";
  }, [input, model]);

  useEffect(() => {
    if (!prefill || typeof prefill.text !== "string") return;
    const timer = setTimeout(() => {
      setInput(prefill.text);
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.style.height = "auto";
        const sh = el.scrollHeight;
        el.style.height = `${Math.min(sh, 160)}px`;
        el.style.overflowY = sh > 160 ? "auto" : "hidden";
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [prefill]);

  useEffect(() => {
    const timer = setTimeout(() => {
    if (!supportsFilePicker) {
      if (selectedAttachments.length > 0) {
        for (const item of selectedAttachments) {
          discardedAttachmentIdsRef.current.add(item.id);
          deleteTemporaryFile(item.fileId);
        }
        setSelectedAttachments([]);
      }
      return;
    }
    const next = selectedAttachments.filter((item) => {
      const inputType = getAttachmentInputType(item.category);
      if (inputType === "image") return supportsImages;
      if (inputType === "video") return supportsVideo;
      if (inputType === "audio") return supportsAudio;
      return false;
    });
    if (next.length !== selectedAttachments.length) {
      const keptIds = new Set(next.map((item) => item.id));
      for (const item of selectedAttachments) {
        if (!keptIds.has(item.id)) {
          discardedAttachmentIdsRef.current.add(item.id);
          if (item.fileId) deleteTemporaryFile(item.fileId);
        }
      }
      setSelectedAttachments(next);
    }
    }, 0);
    return () => clearTimeout(timer);
  }, [selectedAttachments, supportsAudio, supportsFilePicker, supportsImages, supportsVideo]);

  const processFiles = async (files) => {
    if (!supportsFilePicker) return;
    if (!files.length) return;

    const remainingSlots = MAX_CHAT_ATTACHMENTS - selectedAttachments.length;
    const filesToAdd = files.slice(0, remainingSlots);
    const nextAttachments = [];
    const blockedUnsupported = [];
    const invalidFiles = [];
    const oversizedFiles = [];

    if (files.length > remainingSlots) {
      toast.warning(`一次最多添加 ${MAX_CHAT_ATTACHMENTS} 个文件，超出的已跳过`);
    }

    for (const file of filesToAdd) {
      const local = createLocalAttachment({ file });
      if (!local.category) {
        invalidFiles.push(file.name);
        continue;
      }

      const limits = getAttachmentLimits(local.category);
      if (limits?.maxBytes && file.size > limits.maxBytes) {
        oversizedFiles.push(file.name);
        continue;
      }

      const inputType = getAttachmentInputType(local.category);
      const isSupported = (
        (inputType === "image" && supportsImages)
        || (inputType === "video" && supportsVideo)
        || (inputType === "audio" && supportsAudio)
      );

      if (!isSupported) {
        blockedUnsupported.push(file.name);
        continue;
      }

      if (isImageAttachment(local)) {
        let processedFile = file;
        if (!IMAGE_MIME_TYPES.includes(file.type)) {
          const converted = await convertImageFileToPng(file);
          if (!converted) {
            invalidFiles.push(file.name);
            continue;
          }
          processedFile = converted;
        }
        const preview = await readAsDataUrl(processedFile).catch(() => null);
        nextAttachments.push({
          ...createLocalAttachment({ file: processedFile, preview }),
          uploadStatus: "uploading",
          fileId: null,
          fileUrl: null,
        });
      } else {
        const att = { ...local, uploadStatus: "uploading", fileId: null, fileUrl: null };
        nextAttachments.push(att);
      }
    }

    if (oversizedFiles.length > 0) {
      toast.warning(`以下文件超过大小限制，已跳过：${oversizedFiles.join("、")}`);
    }
    if (invalidFiles.length > 0) {
      toast.warning(`以下文件类型不支持或读取失败，已跳过：${invalidFiles.join("、")}`);
    }
    if (blockedUnsupported.length > 0) {
      toast.warning("当前模型或当前模式不支持这类附件，已跳过");
    }

    if (nextAttachments.length > 0 && mountedRef.current) {
      setSelectedAttachments((prev) => [...prev, ...nextAttachments].slice(0, MAX_CHAT_ATTACHMENTS));

      for (const att of nextAttachments) {
        uploadAttachmentInBackground(att);
      }
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    await processFiles(files);
  };

  const handlePaste = async (e) => {
    if (!supportsImages) return;
    const clipboardItems = Array.from(e.clipboardData?.items || []);
    if (!clipboardItems.length) return;

    const imageFiles = clipboardItems
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter(Boolean);

    if (!imageFiles.length) return;
    await processFiles(imageFiles);
  };

  const uploadAttachmentInBackground = async (att) => {
    try {
      const uploaded = await uploadPrivateFile(att.file, { kind: "chat", model });
      if (!mountedRef.current || discardedAttachmentIdsRef.current.has(att.id)) {
        await deleteTemporaryFile(uploaded.fileId);
        return;
      }
      setSelectedAttachments((prev) =>
        prev.map((item) =>
          item.id === att.id
            ? { ...item, uploadStatus: "ready", fileId: uploaded.fileId, fileUrl: uploaded.url }
            : item
        )
      );
    } catch (err) {
      if (!mountedRef.current) return;
      setSelectedAttachments((prev) =>
        prev.map((item) =>
          item.id === att.id ? { ...item, uploadStatus: "error" } : item
        )
      );
      toast.error(`「${att.name}」上传失败：${err?.message || "未知错误"}`);
    }
  };

  const removeAttachment = (attachmentId) => {
    setSelectedAttachments((prev) => {
      const target = prev.find((item) => item.id === attachmentId);
      discardedAttachmentIdsRef.current.add(attachmentId);
      if (target?.fileId) deleteTemporaryFile(target.fileId);
      return prev.filter((item) => item.id !== attachmentId);
    });
  };

  const isUploading = selectedAttachments.some((item) => item.uploadStatus === "uploading");

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      if (!isMobile) {
        e.preventDefault();
        if (!loading && !isUploading) handleSend();
      }
    }
  };

  const handleSend = () => {
    const text = input.trim();
    if ((!text && selectedAttachments.length === 0) || loading || isUploading) return;
    const validAttachments = selectedAttachments.filter((item) => item.uploadStatus === "ready");
    if (!text && validAttachments.length === 0) return;
    onSend({ text, attachments: validAttachments });
    setInput("");
    setSelectedAttachments([]);
  };

  return (
    <div className="max-w-4xl mx-auto w-full relative group/composer">
      <AnimatePresence>
        {selectedAttachments.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="absolute bottom-full mb-3 left-0 right-0 flex flex-wrap gap-2 p-3 glass-effect rounded-2xl shadow-pop border-zinc-200/50 z-30 mx-2 md:mx-0"
          >
            {selectedAttachments.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200/60 shadow-sm"
              >
                {isImageAttachment(item) ? (
                  <div className="relative w-6 h-6 rounded-lg overflow-hidden border border-zinc-100 dark:border-zinc-700">
                    {item.preview ? <NextImage src={item.preview} alt="附件预览" fill sizes="24px" unoptimized className="object-cover" /> : null}
                  </div>
                ) : (
                  <FileText size={14} className="text-primary" />
                )}
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300 truncate max-w-[80px] sm:max-w-[120px]">
                  {item.name}
                </span>
                <button
                  onClick={() => removeAttachment(item.id)}
                  className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-full transition-colors text-zinc-400 hover:text-red-500"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative flex flex-col glass-effect rounded-[24px] border-zinc-200/60 dark:border-zinc-800/60 transition-all duration-300 hover:border-zinc-300 dark:hover:border-zinc-700">
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-zinc-100/50 dark:border-zinc-800/50 bg-zinc-50/30 dark:bg-zinc-900/30 rounded-t-[24px]">
          <ModelSelector
            model={model}
            onModelChange={onModelChange}
            ready={modelReady}
          />
          <SettingsMenu
            model={model}
            ready={modelReady}
            webSearch={webSearch}
            setWebSearch={setWebSearch}
            chatSystemPrompt={chatSystemPrompt}
            onChatSystemPromptSave={onChatSystemPromptSave}
            systemPrompts={systemPrompts}
            addSystemPrompt={addSystemPrompt}
            updateSystemPrompt={updateSystemPrompt}
            deleteSystemPrompt={deleteSystemPrompt}
          />
        </div>
        <div className="relative flex items-end gap-2 p-3 md:p-4 rounded-b-[24px]">
          {supportsFilePicker && (
            <div className="flex items-center mb-1">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                className="hidden"
                accept={attachmentAccept}
                multiple
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={selectedAttachments.length >= MAX_CHAT_ATTACHMENTS}
                className="p-2.5 rounded-xl text-zinc-400 hover:text-primary hover:bg-primary/5 transition-all disabled:opacity-30 active:scale-90"
                type="button"
                title="上传附件"
              >
                <Paperclip size={20} />
              </button>
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => setIsMainInputFocused(true)}
            onBlur={() => setIsMainInputFocused(false)}
            readOnly={false}
            placeholder="给 AI 发送消息…"
            className="flex-1 bg-transparent border-none outline-none focus:ring-0 text-base md:text-[15px] text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 resize-none py-2 min-h-[44px] transition-all no-scrollbar"
            rows={1}
          />

          <div className="flex items-center mb-0.5">
            <button
              onClick={isStreaming || isWaitingForAI ? onStop : handleSend}
              disabled={!isStreaming && !isWaitingForAI && (isUploading || (!input.trim() && selectedAttachments.length === 0))}
              className={`flex items-center justify-center w-9 h-9 rounded-full transition-all active:scale-90 ${
                isStreaming || isWaitingForAI
                  ? "bg-red-500 hover:bg-red-600 text-white"
                  : "bg-primary hover:bg-primary/90 text-white disabled:bg-zinc-200 dark:disabled:bg-zinc-800 disabled:text-zinc-400 dark:disabled:text-zinc-600"
              }`}
              type="button"
            >
              {isStreaming || isWaitingForAI ? (
                <Square size={18} fill="currentColor" />
              ) : (
                <ArrowUp size={18} strokeWidth={2.5} />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
