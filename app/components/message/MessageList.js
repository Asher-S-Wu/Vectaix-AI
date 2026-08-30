"use client";
import { useGuestSession } from "@/lib/client/GuestSession";
import { scopeGuestUrl } from "@/lib/client/guestAccess";


import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import NextImage from "next/image";
import {
  Check,
  Copy,
  Download,
  Edit3,
  Paperclip,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import Markdown from "../common/Markdown";
import ThinkingBlock from "./ThinkingBlock";
import ImageLightbox from "../modals/ImageLightbox";
import ConfirmModal from "../modals/ConfirmModal";
import BrandMark from "../common/BrandMark";
import { BarChart3, Code2, Compass, Sparkles } from "lucide-react";
import { useToast } from "../common/ToastProvider";
import { exportMessageContent } from "@/lib/client/messageExport";
import {
  AttachmentCard,
  AIAvatar,
  ResponsiveAIAvatar,
  buildCopyText,
  normalizeCopiedText,
  isSelectionFullyInsideElement,
  Thumb,
  Citations,
  LoadingSweepText,
  ToolRunCards,
} from "./MessageListHelpers";
import {
  CHAT_MODELS,
  isImageGenerationModel,
  modelSupportsAvailableInput,
} from "@/lib/shared/models";
import { getFileExtension } from "@/lib/shared/attachments";
import {
  IMAGE_EDIT_ACCEPTED_EXTENSIONS,
  IMAGE_EDIT_ACCEPTED_MIME_TYPES,
  IMAGE_EDIT_MAX_BYTES,
  IMAGE_EDIT_MAX_COUNT,
} from "@/lib/media/shared/models";
import {
  STARTER_PROMPTS,
  isPendingRunText,
  normalizeFallbackToolTimeline,
} from "./messageListUtils";

const EXPORT_FORMAT_LABELS = { markdown: "Markdown", pdf: "PDF", docx: "Word 文档" };

function readImagePreview(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target?.result || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const STARTER_ICONS = {
  sparkles: Sparkles,
  code: Code2,
  compass: Compass,
  chart: BarChart3,
};


export default function MessageList({
  messages,
  loading,
  chatEndRef,
  listRef,
  onScroll,
  editingMsgIndex,
  editingContent,
  editingImages,
  fontSizeClass,
  model,
  onEditingContentChange,
  onEditingImagesSelect,
  onEditingImageRemove,
  onCancelEdit,
  onSubmitEdit,
  onCopy,
  onDeleteModelMessage,
  onDeleteUserMessage,
  onRegenerateModelMessage,
  onStartEdit,
  userAvatar,
  userNickname,
  onSendStarterPrompt,
}) {
  const guest = useGuestSession();
  const generationAllowed = !guest || guest.user.allowedModelIds.includes(model);
  const editTextareaRef = useRef(null);
  const editFileInputRef = useRef(null);
  const exportMenuRef = useRef(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, index: null, role: null });
  const [openExportMenuIndex, setOpenExportMenuIndex] = useState(null);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const copyTimerRef = useRef(null);
  const canEditImages = modelSupportsAvailableInput(model, "image");
  const editingImageLimit = isImageGenerationModel(model) ? IMAGE_EDIT_MAX_COUNT : 1;
  const toast = useToast();
  const hasWaitingFirstChunk = messages.some((message) => message?.isWaitingFirstChunk);
  const hasStreamingContent = messages.some((message) => (message?.isStreaming && !message?.isWaitingFirstChunk) || message?.isSearching);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!exportMenuRef.current?.contains(event.target)) {
        setOpenExportMenuIndex(null);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setOpenExportMenuIndex(null);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setOpenExportMenuIndex(null), 0);
    return () => clearTimeout(timer);
  }, [messages.length]);

  const openLightbox = (src) => {
    if (!src) return;
    setLightboxSrc(src);
    setLightboxOpen(true);
  };

  const closeLightbox = () => {
    setLightboxOpen(false);
    setLightboxSrc(null);
  };

  const handleDeleteClick = (index, role) => {
    setDeleteConfirm({ open: true, index, role });
  };

  const handleCopyClick = (index, msg) => {
    onCopy(buildCopyText(msg));
    setCopiedIndex(index);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopiedIndex(null), 1600);
  };

  const handleConfirmDelete = () => {
    if (deleteConfirm.index !== null) {
      if (deleteConfirm.role === "user") {
        onDeleteUserMessage(deleteConfirm.index);
      } else {
        onDeleteModelMessage(deleteConfirm.index);
      }
    }
    setDeleteConfirm({ open: false, index: null, role: null });
  };

  const handleEditFileSelect = async (e) => {
    if (!canEditImages) return;
    const files = Array.from(e.target.files || []);
    if (editFileInputRef.current) editFileInputRef.current.value = "";
    if (files.length === 0) return;

    const remainingSlots = editingImageLimit - editingImages.length;
    if (files.length > remainingSlots) {
      toast.warning(`最多保留 ${editingImageLimit} 张参考图片`);
      return;
    }

    const selected = [];
    for (const file of files) {
      const extension = getFileExtension(file.name);
      const isQwenImage = isImageGenerationModel(model);
      const hasAllowedType = IMAGE_EDIT_ACCEPTED_MIME_TYPES.includes(file.type)
        || IMAGE_EDIT_ACCEPTED_EXTENSIONS.includes(extension);
      if ((isQwenImage && !hasAllowedType) || (!isQwenImage && !file.type.startsWith("image/"))) {
        toast.warning(`“${file.name}”不是支持的图片格式`);
        return;
      }
      if (isQwenImage && (file.size <= 0 || file.size > IMAGE_EDIT_MAX_BYTES)) {
        toast.warning(`“${file.name}”不能超过 10MB`);
        return;
      }
      const preview = await readImagePreview(file).catch(() => "");
      if (!preview) {
        toast.warning(`无法读取“${file.name}”`);
        return;
      }
      selected.push({
        file,
        preview,
        name: file.name,
        mimeType: file.type,
      });
    }
    onEditingImagesSelect?.(selected);
  };

  const isEditingImageUploading = editingImages.some((image) => image?.uploadStatus === "uploading");

  const resizeEditTextarea = useCallback(() => {
    const el = editTextareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 24)}px`;
  }, []);

  const scrollEditIntoView = useCallback(() => {
    const el = editTextareaRef.current;
    const container = listRef?.current;
    if (!el || !container) return;
    const elRect = el.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();
    const delta = elRect.top - (cRect.top + cRect.height / 2);
    container.scrollTo({ top: container.scrollTop + delta, behavior: "auto" });
  }, [listRef]);

  useEffect(() => {
    if (editingMsgIndex === null || editingMsgIndex === undefined) return;
    resizeEditTextarea();
    const el = editTextareaRef.current;
    if (el) {
      try { el.focus({ preventScroll: true }); } catch { el.focus(); }
    }
    requestAnimationFrame(scrollEditIntoView);
    const t = setTimeout(scrollEditIntoView, 80);
    return () => clearTimeout(t);
  }, [editingMsgIndex, resizeEditTextarea, scrollEditIntoView]);

  useEffect(() => {
    if (editingMsgIndex !== null && editingMsgIndex !== undefined) resizeEditTextarea();
  }, [editingContent, editingMsgIndex, resizeEditTextarea]);

  const handleBubbleCopy = (e) => {
    const el = e.currentTarget;
    if (!el || !isSelectionFullyInsideElement(el)) return;
    const selText = window.getSelection?.()?.toString?.();
    if (!selText) return;
    e.preventDefault();
    e.clipboardData?.setData("text/plain", normalizeCopiedText(selText));
  };

  const handleExportMessage = async (format, msg) => {
    try {
      await exportMessageContent(format, buildCopyText(msg));
      toast.success(`已导出 ${EXPORT_FORMAT_LABELS[format] || "文件"}`);
    } catch (error) {
      toast.error(error?.message || "导出失败");
    } finally {
      setOpenExportMenuIndex(null);
    }
  };

  return (
    <div
      ref={listRef}
      onScroll={onScroll}
      className={`flex-1 overflow-y-auto overflow-x-hidden px-3 sm:px-4 py-4 space-y-4 scroll-smooth fade-scrollbar mobile-scroll ${fontSizeClass}`}
    >
      <ImageLightbox open={lightboxOpen} onClose={closeLightbox} src={scopeGuestUrl(lightboxSrc)} />

      <ConfirmModal
        open={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, index: null, role: null })}
        onConfirm={handleConfirmDelete}
        title="删除消息"
        message={`确定要删除这条${deleteConfirm.role === "user" ? "你的" : "AI"}消息吗？此操作无法撤销。`}
        confirmText="删除"
        danger
      />

      {messages.length === 0 ? (
        loading ? (
          <div className="h-full flex flex-col items-center justify-center">
            <div className="flex items-center gap-1.5 px-6 py-4 glass-effect rounded-3xl shadow-sm">
              <LoadingSweepText text="..." ariaText="加载中" className="loading-sweep-dots text-xl" />
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center space-y-10 text-center px-4 max-w-4xl mx-auto w-full relative">
            {/* 背景品牌光晕 */}
            <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className="absolute left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2 w-[420px] h-[420px] rounded-full bg-primary/10 blur-3xl" />
            </div>

            <div className="space-y-6 relative z-10">
              <motion.div
                initial={{ scale: 0.6, opacity: 0, rotate: -12 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                transition={{ type: "spring", damping: 14, stiffness: 180 }}
                className="relative inline-flex items-center justify-center"
              >
                <div className="absolute inset-0 bg-primary/25 blur-3xl rounded-full scale-150" />
                <div className="relative w-20 h-20 rounded-[22px] glass-effect border-primary/20 shadow-lift flex items-center justify-center">
                  <BrandMark size={44} />
                </div>
              </motion.div>
              <div className="space-y-3 relative z-10">
                <h2 className="text-3xl md:text-4xl font-bold bg-gradient-to-br from-zinc-900 via-zinc-700 to-primary dark:from-white dark:via-zinc-200 dark:to-primary bg-clip-text text-transparent tracking-tight">
                  今天能帮您做点什么？
                </h2>
                <p className="text-zinc-400 dark:text-zinc-500 text-[15px] max-w-sm mx-auto leading-relaxed">
                  选择一个模型开始对话，或从下面的灵感开始
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl px-4 relative z-10">
              {STARTER_PROMPTS.map((prompt, idx) => {
                const StarterIcon = STARTER_ICONS[prompt.icon] || Sparkles;
                return (
                  <motion.button
                    key={idx}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 + idx * 0.08, type: "spring", damping: 20 }}
                    onClick={() => onSendStarterPrompt?.(prompt.description)}
                    disabled={!generationAllowed}
                    className="flex flex-col items-start p-4 rounded-2xl glass-effect border-zinc-200/40 hover:border-primary/40 hover:shadow-lift hover:-translate-y-0.5 transition-all duration-300 text-left group active:scale-[0.98]"
                  >
                    <span className="mb-2.5 flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10 text-primary group-hover:bg-primary group-hover:text-white transition-all duration-300">
                      <StarterIcon size={17} strokeWidth={2.2} />
                    </span>
                    <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 mb-1">{prompt.title}</span>
                    <span className="text-xs text-zinc-400 dark:text-zinc-500 line-clamp-1">{prompt.description}</span>
                  </motion.button>
                );
              })}
            </div>
          </div>
        )
      ) : (
        <AnimatePresence initial={false}>
          {messages.map((msg, i) => {
          const fallbackThinkingTimeline = normalizeFallbackToolTimeline(msg.tools);
          const displayParts = Array.isArray(msg.parts) && msg.role === "model"
            ? msg.parts.filter((part) => !(typeof part?.text === "string" && isPendingRunText(part.text)) && !part?.thought)
            : msg.parts;
          const hasParts = Array.isArray(displayParts) && displayParts.some((part) =>
            part?.inlineData?.url || part?.fileData?.name || (typeof part?.text === "string" && part.text.trim().length > 0)
          );
          const hasVisibleContent = typeof msg.content === "string" && msg.content.trim().length > 0 && !isPendingRunText(msg.content);
          const hasBodyOutput =
            hasVisibleContent
            || (hasParts && displayParts.some((part) => part && typeof part.text === "string" && part.text.trim().length > 0));
          const resolvedThinkingTimeline = Array.isArray(msg.thinkingTimeline) && msg.thinkingTimeline.length > 0
            ? msg.thinkingTimeline
            : fallbackThinkingTimeline;
          const hasThinkingTimeline = Array.isArray(resolvedThinkingTimeline)
            && resolvedThinkingTimeline.some((step) => step?.kind === "search" || step?.kind === "reader" || step?.kind === "thought" || step?.kind === "tool" || step?.kind === "planner" || step?.kind === "writer" || step?.kind === "image_gen");
          const hasToolRuns = Array.isArray(msg.tools) && msg.tools.length > 0;
          const shouldRenderToolCards = msg.role === "model" && hasToolRuns && !hasThinkingTimeline && msg.tools.some((t) => t?.id);
          const shouldRenderBubble = hasParts || hasVisibleContent || shouldRenderToolCards;
          const canRegenerateMessage = generationAllowed && msg.role === "model" && messages[i - 1]?.role === "user";
          const isFailedModelMessage = msg.role === "model" && !shouldRenderBubble && !msg.isStreaming && !msg.isWaitingFirstChunk
            && !msg.thought && !msg.isSearching && !msg.searchError && !hasThinkingTimeline && !hasToolRuns;

          if (msg.role === "model" && !msg.thought && !hasVisibleContent && !hasParts && !msg.isSearching && !msg.searchError && !hasThinkingTimeline && !hasToolRuns && msg.isWaitingFirstChunk) {
            return null;
          }

          return (
            <motion.div
              key={msg.id}
              layout="position"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
              className={`flex flex-col gap-3 ${msg.role === "user" ? "items-end" : "items-start"} max-w-4xl mx-auto w-full group`}
            >
              {msg.role === "model" && (msg.thought || hasVisibleContent || (msg.isStreaming && !msg.isWaitingFirstChunk) || hasParts || msg.isSearching || msg.searchError || hasThinkingTimeline || hasToolRuns) && (
                <div className="flex items-center gap-2 pl-1">
                  <AIAvatar model={msg.model || model} size={24} animate={msg.isStreaming} />
                  <span className="text-[11px] text-zinc-400 font-bold tracking-wider">
                    {CHAT_MODELS.find((m) => m.id === (msg.model || model))?.name}
                  </span>
                </div>
              )}

              <div className={`flex flex-col w-full ${msg.role === "user" ? "items-end" : "items-start"}`}>
                {msg.role === "user" && (
                  <div className="flex items-center gap-2 pr-1 mb-1 relative">
                    <span className="text-[11px] text-zinc-500 font-medium truncate max-w-[150px]">
                      {userNickname || "您"}
                    </span>
                    {userAvatar ? (
                      <NextImage src={scopeGuestUrl(userAvatar)} alt="" width={20} height={20} unoptimized className="w-5 h-5 rounded-md object-cover ring-1 ring-zinc-200/50 dark:ring-zinc-700" />
                    ) : (
                      <div className="w-5 h-5 rounded-md bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-[10px] font-bold text-zinc-500">
                        {userNickname?.[0] || "您"}
                      </div>
                    )}
                  </div>
                )}
                {msg.role === "model" && (msg.thought || msg.isSearching || msg.searchError || hasThinkingTimeline) && (
                  <ThinkingBlock
                    thought={msg.thought}
                    isStreaming={msg.isThinkingStreaming}
                    isSearching={msg.isSearching}
                    searchError={msg.searchError}
                    timeline={resolvedThinkingTimeline}
                    tools={msg.tools}
                    bodyText={hasBodyOutput ? "1" : ""}
                    showThoughtDetails
                  />
                )}

                {editingMsgIndex === i && msg.role === "user" ? (
                  <div className="w-full flex flex-col items-end gap-2">
                    <div className="msg-bubble-user w-full max-w-full glass-effect !bg-white border-primary/20">
                      {canEditImages ? (
                        <>
                          <input
                            type="file"
                            ref={editFileInputRef}
                            onChange={handleEditFileSelect}
                            className="hidden"
                            accept={isImageGenerationModel(model)
                              ? [
                                  ...IMAGE_EDIT_ACCEPTED_MIME_TYPES,
                                  ...IMAGE_EDIT_ACCEPTED_EXTENSIONS.map((extension) => `.${extension}`),
                                ].join(",")
                              : "image/*"}
                            multiple={editingImageLimit > 1}
                          />
                          <div className="mb-3 flex flex-wrap items-center gap-2">
                            {editingImages.map((image, imageIndex) => (
                              <div key={image.id} className="relative h-16 w-16 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-900">
                                {image.preview ? (
                                  <NextImage
                                    src={scopeGuestUrl(image.preview)}
                                    alt={`第 ${imageIndex + 1} 张参考图片`}
                                    fill
                                    sizes="64px"
                                    unoptimized
                                    className="object-cover"
                                  />
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => onEditingImageRemove(image.id)}
                                  className="absolute right-0.5 top-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/65 text-white hover:bg-black/80"
                                  title={`移除第 ${imageIndex + 1} 张参考图片`}
                                  aria-label={`移除第 ${imageIndex + 1} 张参考图片`}
                                >
                                  <X size={11} />
                                </button>
                              </div>
                            ))}
                            <button
                              type="button"
                              onClick={() => editFileInputRef.current?.click()}
                              disabled={editingImages.length >= editingImageLimit}
                              className="p-2 text-zinc-500 hover:text-primary hover:bg-primary/5 rounded-lg disabled:cursor-not-allowed disabled:opacity-40"
                              title={editingImages.length > 0 ? "添加参考图片" : "选择参考图片"}
                            >
                              <Paperclip size={14} />
                            </button>
                            {editingImageLimit > 1 ? (
                              <span className="text-[11px] text-zinc-400">
                                {editingImages.length}/{editingImageLimit} 张
                              </span>
                            ) : null}
                          </div>
                        </>
                      ) : null}
                      <textarea
                        ref={editTextareaRef}
                        value={editingContent}
                        onChange={(e) => onEditingContentChange(e.target.value)}
                        className="block w-full max-h-[45vh] resize-none overflow-y-auto fade-scrollbar bg-transparent p-0 text-sm leading-6 text-zinc-800 dark:text-zinc-100 outline-none"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={onCancelEdit} className="px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100 rounded-lg transition-colors">取消</button>
                      <button
                        onClick={() => onSubmitEdit(i)}
                        disabled={!generationAllowed || isEditingImageUploading}
                        className="btn-primary px-3 py-1.5 text-xs rounded-lg disabled:opacity-40"
                      >
                        {isEditingImageUploading ? "上传中" : "提交"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {shouldRenderBubble && (
                      <div
                        className={`relative group/bubble px-4 py-3 sm:px-5 sm:py-4 transition-all duration-300 ${
                          msg.role === "user" ? "msg-bubble-user max-w-[92%] sm:max-w-[85%] md:max-w-[75%]" : "msg-bubble-ai max-w-full md:max-w-[95%] w-full"
                        } ${msg.isStreaming ? "ai-glow ai-glow-active" : ""}`}
                        onCopy={handleBubbleCopy}
                      >
                        {hasParts ? (
                          <div className="flex flex-col gap-2">
                            {(() => {
                              const entries = displayParts.map((part, idx) => ({ part, idx }));
                              const isUser = msg.role === "user";
                              const ordered = isUser
                                ? [...entries.filter(e => e.part?.inlineData?.url), ...entries.filter(e => e.part?.fileData?.name), ...entries.filter(e => e.part?.text)]
                                : entries.filter(e => !e.part?.thought);

                              return ordered.map(({ part, idx }) => {
                                const url = part?.inlineData?.url;
                                const previewUrl = part?.inlineData?.localPreviewUrl;
                                if (url) return <Thumb key={idx} src={scopeGuestUrl(url)} previewSrc={previewUrl} onClick={openLightbox} />;
                                if (part?.fileData?.name) return <AttachmentCard key={idx} file={part.fileData} compact={isUser} />;
                                if (part?.text?.trim()) {
                                  return (
                                    <Markdown
                                      key={idx}
                                      enableHighlight={!msg.isStreaming}
                                      enableMath={true}
                                    >
                                      {part.text}
                                    </Markdown>
                                  );
                                }
                                return null;
                              });
                            })()}
                          </div>
                        ) : hasVisibleContent ? (
                          <>
                            <Markdown
                              enableHighlight={!msg.isStreaming}
                              enableMath={true}
                            >
                              {msg.content}
                            </Markdown>
                            {msg.isStreaming && <span className="stream-caret" aria-hidden="true" />}
                          </>
                        ) : null}
                        {shouldRenderToolCards && <ToolRunCards tools={msg.tools} />}
                        {msg.role === "model" && !msg.isStreaming && msg.citations && <Citations citations={msg.citations} />}
                      </div>
                    )}

                    {isFailedModelMessage && (
                      <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-red-200 bg-red-50 text-red-600 text-sm">
                        <span>生成失败，没有收到有效回复</span>
                        {canRegenerateMessage && (
                          <button
                            onClick={() => onRegenerateModelMessage?.(i)}
                            disabled={loading || hasStreamingContent}
                            className="shrink-0 px-2.5 py-1 rounded-lg bg-red-100 hover:bg-red-200 text-red-600 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            重新生成
                          </button>
                        )}
                      </div>
                    )}

                    {!msg.isStreaming && !isFailedModelMessage && (
                      <div className={`msg-actions flex flex-wrap gap-1 mt-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-all duration-200 translate-y-1 group-hover:translate-y-0 group-focus-within:translate-y-0 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                        {msg.role === "model" && (hasParts || hasVisibleContent) && (
                          <div className="relative" ref={openExportMenuIndex === i ? exportMenuRef : null}>
                            <button onClick={() => setOpenExportMenuIndex(prev => prev === i ? null : i)} className="p-2 text-zinc-400 hover:text-primary hover:bg-primary/5 rounded-lg transition-colors" title="导出" aria-label="导出消息">
                              <Download size={16} />
                            </button>
                            <AnimatePresence>
                              {openExportMenuIndex === i && (
                                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} className={`absolute right-0 z-20 min-w-[150px] rounded-xl glass-effect border-zinc-200/50 p-1.5 shadow-pop ${i >= messages.length - 2 ? "bottom-full mb-1" : "top-full mt-1"}`}>
                                  {["markdown", "pdf", "docx"].map(format => (
                                    <button key={format} onClick={() => handleExportMessage(format, msg)} className="w-full text-left px-3 py-2 text-sm hover:bg-primary/5 rounded-lg transition-colors">{EXPORT_FORMAT_LABELS[format] || format}</button>
                                  ))}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        )}
                        {canRegenerateMessage ? (
                          <button
                            onClick={() => onRegenerateModelMessage?.(i)}
                            disabled={loading || hasStreamingContent}
                            className="p-2 text-zinc-400 hover:text-primary hover:bg-primary/5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-zinc-400"
                            title="重新生成"
                            aria-label="重新生成"
                          >
                            <RefreshCw size={16} />
                          </button>
                        ) : null}
                        <button
                          onClick={() => handleCopyClick(i, msg)}
                          className={`p-2 rounded-lg transition-colors ${copiedIndex === i ? "text-emerald-500" : "text-zinc-400 hover:text-primary hover:bg-primary/5"}`}
                          title="复制内容"
                          aria-label="复制内容"
                        >
                          {copiedIndex === i ? <Check size={16} /> : <Copy size={16} />}
                        </button>
                        <button onClick={() => handleDeleteClick(i, msg.role)} className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="删除" aria-label="删除消息"><Trash2 size={16} /></button>
                        {generationAllowed && msg.role === "user" && (
                          <button onClick={() => onStartEdit(i, msg)} className="p-2 text-zinc-400 hover:text-primary hover:bg-primary/5 rounded-lg transition-colors" title="编辑" aria-label="编辑消息"><Edit3 size={16} /></button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          );
          })}
        </AnimatePresence>
      )}

      {messages.length > 0 && (loading || hasWaitingFirstChunk) && !hasStreamingContent && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="flex gap-3 items-start max-w-4xl mx-auto w-full"
        >
          <ResponsiveAIAvatar model={model} desktopSize={24} animate />
          <div className="msg-bubble-ai px-5 py-3.5">
            <LoadingSweepText text="..." className="loading-sweep-dots text-xl" />
          </div>
        </motion.div>
      )}

      <div ref={chatEndRef} />
    </div>
  );
}
