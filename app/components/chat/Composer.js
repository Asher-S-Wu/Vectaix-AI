"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import NextImage from "next/image";
import {
  AlertCircle,
  ArrowUp,
  FileText,
  Loader2,
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
  isImageGenerationModel,
  isMediaGenerationModel,
} from "@/lib/shared/models";
import {
  IMAGE_EDIT_ACCEPTED_EXTENSIONS,
  IMAGE_EDIT_ACCEPTED_MIME_TYPES,
  IMAGE_EDIT_MAX_BYTES,
  IMAGE_EDIT_MAX_COUNT,
  IMAGE_SIZE_OPTIONS,
} from "@/lib/media/shared/models";
import {
  getAttachmentInputType,
  getAttachmentAcceptForModel,
  getAttachmentLimits,
  IMAGE_MIME_TYPES,
  MAX_CHAT_ATTACHMENTS,
} from "@/lib/shared/attachments";
import { createLocalAttachment, isImageAttachment } from "@/lib/shared/messageAttachments";
import { convertImageFileToPng, readAsDataUrl } from "./composerFileUtils";

const QWEN_ONLY_IMAGE_EXTENSIONS = new Set(["bmp", "tif", "tiff"]);

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
  const [imageSize, setImageSize] = useState("auto");
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const mountedRef = useRef(true);
  const discardedAttachmentIdsRef = useRef(new Set());
  const [dragActive, setDragActive] = useState(false);
  const dragDepthRef = useRef(0);
  const {
    supportsImages,
    supportsVideo,
    supportsAudio,
    supportsFilePicker,
  } = getModelAttachmentSupport(model);
  const isMediaModel = isMediaGenerationModel(model);
  const isImageModel = isImageGenerationModel(model);
  const attachmentLimit = isImageModel
    ? IMAGE_EDIT_MAX_COUNT
    : isMediaModel
      ? 1
      : MAX_CHAT_ATTACHMENTS;
  const attachmentAccept = isImageModel
    ? [
        ...IMAGE_EDIT_ACCEPTED_MIME_TYPES,
        ...IMAGE_EDIT_ACCEPTED_EXTENSIONS.map((extension) => `.${extension}`),
      ].join(",")
    : getAttachmentAcceptForModel({
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
        document.documentElement.style.setProperty("--app-height", `${Math.round(vv?.height ?? window.innerHeight)}px`);
        document.documentElement.style.setProperty("--app-offset-top", `${Math.round(vv?.offsetTop ?? 0)}px`);
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
      if (inputType === "image") {
        const isQwenOnlyImage = QWEN_ONLY_IMAGE_EXTENSIONS.has(item.extension);
        return supportsImages && (!isQwenOnlyImage || isImageModel);
      }
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
  }, [isImageModel, selectedAttachments, supportsAudio, supportsFilePicker, supportsImages, supportsVideo]);

  const processFiles = async (files) => {
    if (!supportsFilePicker) return;
    if (!files.length) return;

    const remainingSlots = attachmentLimit - selectedAttachments.length;
    const filesToAdd = files.slice(0, remainingSlots);
    const nextAttachments = [];
    const blockedUnsupported = [];
    const invalidFiles = [];
    const oversizedFiles = [];

    if (files.length > remainingSlots) {
      toast.warning(`一次最多添加 ${attachmentLimit} 个文件，超出的已跳过`);
    }

    for (const file of filesToAdd) {
      const local = createLocalAttachment({ file });
      if (!local.category) {
        invalidFiles.push(file.name);
        continue;
      }

      const limits = getAttachmentLimits(local.category);
      const maxBytes = isImageModel && local.category === "image"
        ? IMAGE_EDIT_MAX_BYTES
        : limits?.maxBytes;
      if (maxBytes && file.size > maxBytes) {
        oversizedFiles.push(file.name);
        continue;
      }

      const inputType = getAttachmentInputType(local.category);
      const isQwenOnlyImage = inputType === "image"
        && QWEN_ONLY_IMAGE_EXTENSIONS.has(local.extension);
      const isSupported = (
        (inputType === "image" && supportsImages)
        || (inputType === "video" && supportsVideo)
        || (inputType === "audio" && supportsAudio)
      ) && (!isQwenOnlyImage || isImageModel);

      if (!isSupported) {
        blockedUnsupported.push(file.name);
        continue;
      }

      if (isImageAttachment(local)) {
        let processedFile = file;
        const isNativeQwenImage = isImageModel
          && IMAGE_EDIT_ACCEPTED_EXTENSIONS.includes(local.extension);
        if (!IMAGE_MIME_TYPES.includes(file.type) && !isNativeQwenImage) {
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
      setSelectedAttachments((prev) => [...prev, ...nextAttachments].slice(0, attachmentLimit));

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
            ? {
                ...item,
                uploadStatus: "ready",
                fileId: uploaded.fileId,
                fileUrl: uploaded.url,
                mimeType: uploaded.mimeType || item.mimeType,
                extension: uploaded.extension || item.extension,
                category: uploaded.category || item.category,
              }
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

  const retryAttachment = (att) => {
    setSelectedAttachments((prev) =>
      prev.map((item) => (item.id === att.id ? { ...item, uploadStatus: "uploading" } : item))
    );
    uploadAttachmentInBackground(att);
  };

  const handleDragEnter = (e) => {
    if (!supportsFilePicker) return;
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  };

  const handleDragLeave = (e) => {
    if (!supportsFilePicker) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  };

  const handleDragOver = (e) => {
    if (!supportsFilePicker) return;
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDrop = async (e) => {
    if (!supportsFilePicker) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length > 0) await processFiles(files);
  };

  const isUploading = selectedAttachments.some((item) => item.uploadStatus === "uploading");
  const hasReadyAttachment = selectedAttachments.some((item) => item.uploadStatus === "ready");
  const canSend = isImageModel ? Boolean(input.trim()) : Boolean(input.trim()) || hasReadyAttachment;

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
    if (isImageModel && !text) {
      toast.warning("请输入图片描述");
      return;
    }
    const validAttachments = selectedAttachments.filter((item) => item.uploadStatus === "ready");
    if (!text && validAttachments.length === 0) {
      toast.warning("附件未上传成功，请重试或移除后再发送");
      return;
    }
    const mediaOptions = isImageModel ? { size: imageSize } : undefined;
    onSend({ text, attachments: validAttachments, mediaOptions });
    setInput("");
    setSelectedAttachments([]);
  };

  return (
    <div
      className="max-w-4xl mx-auto w-full relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <AnimatePresence>
        {dragActive && (
          <motion.div
            key="drop-overlay"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="pointer-events-none absolute -inset-2 z-40 flex items-center justify-center rounded-[28px] border-2 border-dashed border-primary bg-primary/10 backdrop-blur-[2px]"
          >
            <span className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-white shadow-lift">
              <Paperclip size={15} />
              松开以添加附件
            </span>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {selectedAttachments.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="absolute bottom-full mb-3 left-0 right-0 flex flex-wrap gap-2 p-3 glass-effect rounded-2xl shadow-pop border-zinc-200/50 z-30 mx-2 md:mx-0"
          >
            <AnimatePresence initial={false}>
              {selectedAttachments.map((item) => (
                <motion.div
                  layout
                  key={item.id}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.12 } }}
                  transition={{ type: "spring", damping: 22, stiffness: 350 }}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white dark:bg-zinc-800 border shadow-sm ${item.uploadStatus === "error" ? "border-red-300" : "border-zinc-200/60"}`}
                >
                  {item.uploadStatus === "uploading" ? (
                    <Loader2 size={14} className="animate-spin text-primary shrink-0" />
                  ) : item.uploadStatus === "error" ? (
                    <AlertCircle size={14} className="text-red-500 shrink-0" />
                  ) : isImageAttachment(item) ? (
                    <div className="relative w-6 h-6 rounded-lg overflow-hidden border border-zinc-100 dark:border-zinc-700">
                      {item.preview ? <NextImage src={item.preview} alt="附件预览" fill sizes="24px" unoptimized className="object-cover" /> : null}
                    </div>
                  ) : (
                    <FileText size={14} className="text-primary" />
                  )}
                  <span className={`text-xs font-medium truncate max-w-[80px] sm:max-w-[120px] ${item.uploadStatus === "error" ? "text-red-500" : "text-zinc-600 dark:text-zinc-300"}`}>
                    {item.name}
                  </span>
                  {item.uploadStatus === "error" && (
                    <button
                      onClick={() => retryAttachment(item)}
                      className="text-[11px] font-medium text-primary hover:underline shrink-0"
                      title="重试上传"
                    >
                      重试
                    </button>
                  )}
                  <button
                    onClick={() => removeAttachment(item.id)}
                    aria-label="移除附件"
                    className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-full transition-colors text-zinc-400 hover:text-red-500"
                  >
                    <X size={12} />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="composer-shell relative flex flex-col glass-effect rounded-[24px] border-zinc-200/60 dark:border-zinc-800/60 hover:border-zinc-300 dark:hover:border-zinc-700">
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-zinc-100/50 dark:border-zinc-800/50 bg-zinc-50/30 dark:bg-zinc-900/30 rounded-t-[24px]">
          <ModelSelector
            model={model}
            onModelChange={onModelChange}
            ready={modelReady}
          />
          {isMediaModel ? (
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1.5">
              {isImageModel ? (
                <select
                  aria-label="图片尺寸"
                  value={imageSize}
                  onChange={(event) => setImageSize(event.target.value)}
                  className="h-8 max-w-[170px] rounded-lg border border-zinc-200 bg-transparent px-2 text-xs text-zinc-600 outline-none cursor-pointer transition-colors hover:border-zinc-300 focus:border-primary dark:border-zinc-700 dark:text-zinc-300"
                >
                  {IMAGE_SIZE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              ) : null}
            </div>
          ) : (
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
          )}
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
                multiple={!isMediaModel || isImageModel}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={selectedAttachments.length >= attachmentLimit}
                className="p-2.5 rounded-xl text-zinc-500 hover:text-primary hover:bg-primary/5 transition-all disabled:opacity-30 disabled:cursor-not-allowed active:scale-90"
                type="button"
                title="上传附件"
                aria-label="上传附件"
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
            placeholder={isImageModel ? "描述你想生成或修改的图片…" : "给 AI 发送消息…"}
            className="flex-1 bg-transparent border-none outline-none focus:ring-0 text-base md:text-[15px] text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 resize-none py-2 min-h-[44px] transition-all no-scrollbar"
            rows={1}
          />

          <div className="flex items-center mb-0.5">
            <button
              onClick={isStreaming || isWaitingForAI ? onStop : handleSend}
              disabled={!isStreaming && !isWaitingForAI && (isUploading || !canSend)}
              className={`flex items-center justify-center w-9 h-9 rounded-full transition-all duration-200 active:scale-90 disabled:cursor-not-allowed ${
                isStreaming || isWaitingForAI
                  ? "bg-red-500 hover:bg-red-600 text-white shadow-soft"
                  : "btn-primary disabled:bg-zinc-200 dark:disabled:bg-zinc-800 disabled:text-zinc-400 dark:disabled:text-zinc-600 disabled:shadow-none"
              }`}
              type="button"
              aria-label={isStreaming || isWaitingForAI ? "停止生成" : "发送"}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={isStreaming || isWaitingForAI ? "stop" : "send"}
                  initial={{ scale: 0.4, opacity: 0, rotate: -90 }}
                  animate={{ scale: 1, opacity: 1, rotate: 0 }}
                  exit={{ scale: 0.4, opacity: 0, rotate: 90 }}
                  transition={{ duration: 0.15 }}
                  className="flex items-center justify-center"
                >
                  {isStreaming || isWaitingForAI ? (
                    <Square size={18} fill="currentColor" />
                  ) : (
                    <ArrowUp size={18} strokeWidth={2.5} />
                  )}
                </motion.span>
              </AnimatePresence>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
