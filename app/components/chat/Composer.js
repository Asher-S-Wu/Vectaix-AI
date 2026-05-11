"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUp,
  FileText,
  Paperclip,
  Square,
  X,
} from "lucide-react";
import { upload } from "@vercel/blob/client";
import { useToast } from "../common/ToastProvider";
import ModelSelector from "./ModelSelector";
import SettingsMenu from "../settings/SettingsMenu";
import {
  COUNCIL_MAX_ROUNDS,
  countCompletedCouncilRounds,
  getModelAttachmentSupport,
  isCouncilModel,
  isImageGenModel,
} from "@/lib/shared/models";
import {
  getAttachmentInputType,
  getAttachmentAcceptForModel,
  getAttachmentLimits,
  IMAGE_MIME_TYPES,
  MAX_CHAT_ATTACHMENTS,
} from "@/lib/shared/attachments";
import { createLocalAttachment, isImageAttachment } from "@/lib/shared/messageAttachments";
import {
  IMAGE_GEN_RESOLUTION_OPTIONS,
  getImageGenSizeOptionsForResolution,
  isImageGenSizeSupportedAtResolution,
} from "@/lib/shared/imageGenOptions";
import { convertImageFileToPng, readAsDataUrl } from "./composerFileUtils";

export default function Composer({
  loading,
  isStreaming,
  isWaitingForAI,
  model,
  modelReady,
  onModelChange,
  messages,
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
  attachmentRequest,
}) {
  const toast = useToast();
  const [input, setInput] = useState("");
  const [selectedAttachments, setSelectedAttachments] = useState([]);
  const [isMainInputFocused, setIsMainInputFocused] = useState(false);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const mountedRef = useRef(true);
  const handledAttachmentRequestNonceRef = useRef(null);
  const isCouncilSelected = isCouncilModel(model);
  const isImageGenSelected = isImageGenModel(model);
  const [imageGenSize, setImageGenSize] = useState("1:1");
  const [imageGenResolution, setImageGenResolution] = useState("1k");
  const imageGenSizeOptions = useMemo(
    () => getImageGenSizeOptionsForResolution(imageGenResolution),
    [imageGenResolution]
  );
  const {
    supportsImages,
    supportsDocuments,
    supportsVideo,
    supportsAudio,
    supportsFilePicker,
  } = getModelAttachmentSupport(model);
  const attachmentAccept = getAttachmentAcceptForModel({
    supportsDocuments,
    supportsImages,
    supportsVideo,
    supportsAudio,
  });
  const completedCouncilRounds = isCouncilSelected ? countCompletedCouncilRounds(messages) : 0;
  const hasReachedCouncilRoundLimit = isCouncilSelected && completedCouncilRounds >= COUNCIL_MAX_ROUNDS;

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
    setInput(prefill.text);
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.style.height = "auto";
      const sh = el.scrollHeight;
      el.style.height = `${Math.min(sh, 160)}px`;
      el.style.overflowY = sh > 160 ? "auto" : "hidden";
    }
  }, [prefill?.nonce]);

  useEffect(() => {
    const nonce = attachmentRequest?.nonce;
    if (!nonce || handledAttachmentRequestNonceRef.current === nonce) return;
    handledAttachmentRequestNonceRef.current = nonce;

    if (!supportsFilePicker || !supportsImages) {
      toast.warning("当前模型不支持图片附件");
      return;
    }

    if (selectedAttachments.length >= MAX_CHAT_ATTACHMENTS) {
      toast.warning(`一次最多添加 ${MAX_CHAT_ATTACHMENTS} 个文件`);
      return;
    }

    const url = typeof attachmentRequest.url === "string" ? attachmentRequest.url : "";
    const mimeType = typeof attachmentRequest.mimeType === "string" ? attachmentRequest.mimeType : "";
    if (!url || !mimeType) {
      toast.error("图片信息不完整，无法加入附件");
      return;
    }

    const extension = mimeType === "image/jpeg"
      ? "jpg"
      : (mimeType === "image/webp" ? "webp" : "png");
    setSelectedAttachments((prev) => [
      ...prev,
      {
        id: `message-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file: null,
        preview: url,
        blobUrl: url,
        uploadStatus: "ready",
        name: attachmentRequest.name || `生成图片.${extension}`,
        size: Number(attachmentRequest.size) || 0,
        mimeType,
        extension,
        category: "image",
      },
    ].slice(0, MAX_CHAT_ATTACHMENTS));
    toast.success("已添加到输入框附件");
  }, [attachmentRequest, selectedAttachments.length, supportsFilePicker, supportsImages, toast]);

  useEffect(() => {
    if (!isImageGenSelected) return;
    if (isImageGenSizeSupportedAtResolution(imageGenSize, imageGenResolution)) return;
    const nextSize = imageGenSizeOptions[0]?.value;
    if (nextSize) setImageGenSize(nextSize);
  }, [imageGenResolution, imageGenSize, imageGenSizeOptions, isImageGenSelected]);

  useEffect(() => {
    if (!supportsFilePicker) {
      if (selectedAttachments.length > 0) {
        setSelectedAttachments([]);
      }
      return;
    }
    const next = selectedAttachments.filter((item) => {
      const inputType = getAttachmentInputType(item.category);
      if (inputType === "image") return supportsImages;
      if (inputType === "video") return supportsVideo;
      if (inputType === "audio") return supportsAudio;
      if (inputType === "file") return supportsDocuments;
      return false;
    });
    if (next.length !== selectedAttachments.length) {
      setSelectedAttachments(next);
    }
  }, [selectedAttachments, supportsAudio, supportsDocuments, supportsFilePicker, supportsImages, supportsVideo]);

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
        || (inputType === "file" && supportsDocuments)
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
          blobUrl: null,
        });
      } else {
        const att = { ...local, uploadStatus: "uploading", blobUrl: null };
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
      const blob = await upload(att.file.name, att.file, {
        access: "public",
        handleUploadUrl: "/api/upload",
        clientPayload: JSON.stringify({
          kind: "chat",
          model,
          originalName: att.file.name,
          declaredMimeType: att.file.type || att.mimeType,
        }),
      });
      if (!mountedRef.current) return;
      setSelectedAttachments((prev) =>
        prev.map((item) =>
          item.id === att.id ? { ...item, uploadStatus: "ready", blobUrl: blob.url } : item
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
    setSelectedAttachments((prev) => prev.filter((item) => item.id !== attachmentId));
  };

  const clearAllAttachments = () => {
    setSelectedAttachments([]);
  };

  const handleImageGenResolutionChange = (nextResolution) => {
    setImageGenResolution(nextResolution);
    if (isImageGenSizeSupportedAtResolution(imageGenSize, nextResolution)) return;
    const nextSize = getImageGenSizeOptionsForResolution(nextResolution)[0]?.value;
    if (nextSize) setImageGenSize(nextSize);
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
    if (hasReachedCouncilRoundLimit) {
      toast.warning(`Council 最多支持 ${COUNCIL_MAX_ROUNDS} 轮对话，请新建对话继续。`);
      return;
    }
    if (isImageGenSelected) {
      onSend({ text, attachments: validAttachments, imageGenSize, imageGenResolution });
    } else {
      onSend({ text, attachments: validAttachments });
    }
    setInput("");
    clearAllAttachments();
  };

  return (
    <div className="max-w-4xl mx-auto w-full relative group/composer">
      <AnimatePresence>
        {selectedAttachments.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="absolute bottom-full mb-3 left-0 right-0 flex flex-wrap gap-2 p-3 glass-effect rounded-2xl shadow-xl border-zinc-200/50 z-30 mx-2 md:mx-0"
          >
            {selectedAttachments.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200/60 shadow-sm animate-in fade-in slide-in-from-bottom-1"
              >
                {isImageAttachment(item) ? (
                  <div className="w-6 h-6 rounded-lg overflow-hidden border border-zinc-100 dark:border-zinc-700">
                    {item.preview ? <img src={item.preview} alt="" className="w-full h-full object-cover" /> : null}
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
          {!isCouncilSelected ? (
            <>
              <ModelSelector
                model={model}
                onModelChange={onModelChange}
                ready={modelReady}
                includeCouncil={false}
              />
              {isImageGenSelected ? (
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <select
                    value={imageGenSize}
                    onChange={(e) => setImageGenSize(e.target.value)}
                    className="px-1.5 sm:px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs sm:text-sm bg-transparent text-zinc-600 dark:text-zinc-400 outline-none cursor-pointer"
                  >
                    {imageGenSizeOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <select
                    value={imageGenResolution}
                    onChange={(e) => handleImageGenResolutionChange(e.target.value)}
                    className="px-1.5 sm:px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs sm:text-sm bg-transparent text-zinc-600 dark:text-zinc-400 outline-none cursor-pointer"
                  >
                    {IMAGE_GEN_RESOLUTION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
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
            </>
          ) : null}
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
                disabled={hasReachedCouncilRoundLimit || selectedAttachments.length >= MAX_CHAT_ATTACHMENTS}
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
            readOnly={hasReachedCouncilRoundLimit}
            placeholder={hasReachedCouncilRoundLimit ? `已达到 ${COUNCIL_MAX_ROUNDS} 轮上限...` : isImageGenSelected ? "描述您想生成的图片..." : "给 AI 发送消息..."}
            className="flex-1 bg-transparent border-none outline-none focus:ring-0 text-base md:text-[15px] text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 resize-none py-2 min-h-[44px] transition-all scrollbar-none"
            rows={1}
          />

          <div className="flex items-center mb-0.5">
            <button
              onClick={isStreaming || isWaitingForAI ? onStop : handleSend}
              disabled={!isStreaming && !isWaitingForAI && (hasReachedCouncilRoundLimit || isUploading || (!input.trim() && selectedAttachments.length === 0))}
              className={`flex items-center justify-center w-9 h-9 rounded-full transition-all active:scale-90 ${
                isStreaming || isWaitingForAI 
                  ? "bg-red-500 hover:bg-red-600 text-white" 
                  : "bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-700 dark:hover:bg-zinc-300 text-white dark:text-zinc-900 disabled:bg-zinc-200 dark:disabled:bg-zinc-800 disabled:text-zinc-400 dark:disabled:text-zinc-600"
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
