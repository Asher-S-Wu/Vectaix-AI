"use client";

import { useI18n } from "@/lib/client/i18n";


import ImageResults from '@/app/components/media/ImageResults';
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import NextImage from "next/image";
import {
  Check,
  Copy,
  Download,
  Edit3,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import Markdown from "../common/Markdown";
import TaskDelivery from "./TaskDelivery";
import ReplyActions from "./ReplyActions";
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
  getStarterPrompts,
  isPendingRunText,
  normalizeFallbackToolTimeline,
} from "./messageListUtils";

const STARTER_ICONS = {
  sparkles: Sparkles,
  code: Code2,
  compass: Compass,
  chart: BarChart3,
};


export default function MessageList({
  tasks = [],
  messages,
  loading,
  chatEndRef,
  listRef,
  onScroll,
  editingMsgIndex,
  editingContent,
  editingImages,
  fontSizeClass,
  onEditingContentChange,
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
  assistant,
  onSendStarterPrompt,
}) {
  const { t, locale, formatNumber, localizeMessage } = useI18n();
  const EXPORT_FORMAT_LABELS = { markdown: "Markdown", pdf: "PDF", docx: t("Word 文档", "Word document") };
  const editTextareaRef = useRef(null);
  const exportMenuRef = useRef(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, index: null, role: null });
  const [replaceConfirm, setReplaceConfirm] = useState(null);
  const [openExportMenuIndex, setOpenExportMenuIndex] = useState(null);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const copyTimerRef = useRef(null);
  const toast = useToast();
  const firstMessageId = messages[0]?.id;
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
  }, [messages.length, firstMessageId]);

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

  const handleCopyClick = async (index, msg) => {
    try {
      await onCopy(buildCopyText(msg, locale));
      setCopiedIndex(index);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedIndex(null), 1600);
    } catch { toast.error(["复制失败，请检查浏览器的剪贴板权限。", "Could not copy. Check your browser's clipboard permission."]); }
  };

  useEffect(() => () => clearTimeout(copyTimerRef.current), []);

  const requestRegenerate = index => setReplaceConfirm({ messageId: messages[index].id, mode: "regenerate" });
  const requestSubmitEdit = () => {
    if (messages.length > editingMsgIndex + 1) setReplaceConfirm({ messageId: messages[editingMsgIndex].id, mode: "edit" });
    else onSubmitEdit();
  };
  const confirmReplacement = async () => {
    const index = messages.findIndex(message => message.id === replaceConfirm?.messageId);
    if (index >= 0) {
      if (replaceConfirm.mode === "edit") await onSubmitEdit();
      else await onRegenerateModelMessage?.(index);
    }
    setReplaceConfirm(null);
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
      await exportMessageContent(format, buildCopyText(msg, locale));
      toast.success(["已导出 {format}", "Exported as {format}", { format: format === "docx" ? ["Word 文档", "Word document"] : EXPORT_FORMAT_LABELS[format] || ["文件", "File"] }]);
    } catch (error) {
      toast.error(localizeMessage(error?.message) || ["导出失败", "Export failed"]);
    } finally {
      setOpenExportMenuIndex(null);
    }
  };

  return (
    <div
      ref={listRef}
      onScroll={onScroll}
      className={`flex-1 overflow-y-auto overflow-x-hidden px-3 sm:px-4 py-4 space-y-4 motion-safe:scroll-smooth motion-reduce:scroll-auto fade-scrollbar mobile-scroll ${fontSizeClass}`}
    >
      <ImageLightbox open={lightboxOpen} onClose={closeLightbox} src={lightboxSrc} />

      <ConfirmModal
        open={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, index: null, role: null })}
        onConfirm={handleConfirmDelete}
        title={t("删除消息", "Delete message")}
        message={deleteConfirm.role === "user" ? t("删除这条消息、紧随其后的 AI 回复及对应任务成果？后续对话会保留。使用中的文件须先从相关消息移除引用。此操作无法撤销。", "Delete this message, its following AI reply, and its task results? Later messages will remain. Remove file references from other messages first. This action is permanent.") : t("删除这条 AI 回复及对应任务成果？使用中的文件须先从相关消息移除引用。此操作无法撤销。", "Delete this AI reply and its task results? Remove file references from other messages first. This action is permanent.")}
        confirmText={t("删除", "Delete")}
        danger
      />
      <ConfirmModal
        open={Boolean(replaceConfirm)}
        onClose={() => setReplaceConfirm(null)}
        onConfirm={confirmReplacement}
        title={replaceConfirm?.mode === "edit" ? t("修改历史消息", "Edit an earlier message") : t("重新生成回复", "Regenerate reply")}
        message={t("这条消息的原回复、后续对话、任务历史与成果将永久删除，再从这里重新生成。确认继续？", "This will permanently delete the original reply, all later messages, task history, and results, then generate again from this message. Continue?")}
        confirmText={t("确认并重新生成", "Confirm and regenerate")}
        danger
      />

      {messages.length === 0 ? (
        loading ? (
          <div className="h-full flex flex-col items-center justify-center">
            <div className="flex items-center gap-1.5 px-6 py-4 glass-effect rounded-3xl shadow-sm">
              <LoadingSweepText text="..." ariaText={t("加载中", "Loading")} className="loading-sweep-dots text-xl" />
            </div>
          </div>
        ) : (
          <div className="huajuan-welcome">
            <div className="welcome-brand"><BrandMark size={108} /><span className="welcome-note">{t("花卷", "Huajuan")}</span></div>
            <h1>{t("你想完成什么？", "What would you like to work on?")}</h1>
            <p className="welcome-description">{t("输入问题或上传文件，让花卷帮你查资料、分析数据、起草文稿。", "Ask a question or upload a file. Huajuan can research topics, analyze data, and draft documents.")}</p>
            <div className="welcome-prompts">
              {getStarterPrompts(locale).map(prompt => {
                const StarterIcon = STARTER_ICONS[prompt.icon];
                return <button type="button" key={prompt.title} onClick={() => onSendStarterPrompt?.(prompt.description)} className="welcome-prompt"><StarterIcon size={18} strokeWidth={1.6} /><span>{prompt.title}</span><span aria-hidden="true" className="welcome-prompt-plus">+</span></button>;
              })}
            </div>
            <p className="welcome-footnote">{t("选一个任务开始，或在下方输入你的需求。", "Choose a task above, or describe what you need below.")}</p>
          </div>
        )
      ) : (
        <AnimatePresence key={firstMessageId} initial={false}>
          {messages.map((msg, i) => {
          const fallbackThinkingTimeline = normalizeFallbackToolTimeline(msg.tools, locale);
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
          const canRegenerateMessage = msg.role === "model" && messages[i - 1]?.role === "user";
          const isFailedModelMessage = msg.role === "model" && !msg.taskId && !shouldRenderBubble && !msg.isStreaming && !msg.isWaitingFirstChunk
            && !msg.thought && !msg.isSearching && !msg.searchError && !hasThinkingTimeline && !hasToolRuns;

          if (msg.role === "model" && !msg.taskId && !msg.thought && !hasVisibleContent && !hasParts && !msg.isSearching && !msg.searchError && !hasThinkingTimeline && !hasToolRuns && msg.isWaitingFirstChunk) {
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
              {msg.role === "model" && (msg.taskId || msg.thought || hasVisibleContent || (msg.isStreaming && !msg.isWaitingFirstChunk) || hasParts || msg.isSearching || msg.searchError || hasThinkingTimeline || hasToolRuns) && (
                <div className="flex items-center gap-2 pl-1">
                  {assistant?.avatarFileId ? <NextImage src={`/api/files/${assistant.avatarFileId}`} alt={assistant.name === "花卷" ? t("花卷", "Huajuan") : assistant.name} width={24} height={24} unoptimized className="h-6 w-6 rounded-lg object-cover" /> : <AIAvatar size={24} />}
                  <span className="text-[11px] text-zinc-400 font-bold tracking-wider">
                    {assistant?.name === "花卷" ? t("花卷", "Huajuan") : assistant?.name}
                  </span>
                </div>
              )}

              <div className={`flex flex-col w-full ${msg.role === "user" ? "items-end" : "items-start"}`}>
                {msg.role === "user" && (
                  <div className="flex items-center gap-2 pr-1 mb-1 relative">
                    <span className="text-[11px] text-zinc-500 font-medium truncate max-w-[150px]">
                      {userNickname || t("你", "You")}
                    </span>
                    {userAvatar ? (
                      <NextImage src={userAvatar} alt="" width={20} height={20} unoptimized className="w-5 h-5 rounded-md object-cover ring-1 ring-zinc-200/50 dark:ring-zinc-700" />
                    ) : (
                      <div className="w-5 h-5 rounded-md bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-[10px] font-bold text-zinc-500">
                        {userNickname?.[0] || t("你", "Y")}
                      </div>
                    )}
                  </div>
                )}
                {msg.role === "model" && msg.taskId && <TaskDelivery message={msg} task={tasks.find(task => task._id === String(msg.taskId))} />}
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
                      {editingImages.length > 0 && (
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          {editingImages.map((image, imageIndex) => (
                            <div key={image.id} className={`relative overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-900 ${image.file ? "w-full max-w-sm p-2 pr-8" : "h-16 w-16"}`}>
                              {image.preview ? (
                                <NextImage
                                  src={image.preview}
                                  alt={t("参考图片 {number}", "Reference image {number}", { number: formatNumber(imageIndex + 1) })}
                                  fill
                                  sizes="64px"
                                  unoptimized
                                  className="object-cover"
                                />
                              ) : image.file ? <AttachmentCard file={image.file} compact /> : null}
                              <button
                                type="button"
                                onClick={() => onEditingImageRemove(image.id)}
                                className="absolute right-0.5 top-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/65 text-white hover:bg-black/80"
                                title={image.file ? t("移除 {name}", "Remove {name}", { name: image.file.name }) : t("移除参考图片 {number}", "Remove reference image {number}", { number: formatNumber(imageIndex + 1) })}
                                aria-label={image.file ? t("移除 {name}", "Remove {name}", { name: image.file.name }) : t("移除参考图片 {number}", "Remove reference image {number}", { number: formatNumber(imageIndex + 1) })}
                              >
                                <X size={11} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <textarea
                        ref={editTextareaRef}
                        value={editingContent}
                        aria-label={t("编辑消息", "Edit message")}
                        onChange={(e) => onEditingContentChange(e.target.value)}
                        className="block w-full max-h-[45vh] resize-none overflow-y-auto fade-scrollbar bg-transparent p-0 text-sm leading-6 text-zinc-800 dark:text-zinc-100 outline-none"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={onCancelEdit} className="px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100 rounded-lg transition-colors">{t("取消", "Cancel")}</button>
                      <button
                        onClick={requestSubmitEdit}
                        className="btn-primary px-3 py-1.5 text-xs rounded-lg disabled:opacity-40"
                      >
                        {t("提交", "Send")}
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
                        {hasParts && msg.role === "model" && msg.providerState?.media?.type === "image" ? (
                          <ImageResults results={displayParts.map(part => part.inlineData ? { success: true, ...part.inlineData } : { success: false, message: part.text })} />
                        ) : hasParts ? (
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
                                if (url) return <Thumb key={idx} src={url} previewSrc={previewUrl} onClick={openLightbox} />;
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
                        <span>{t("回复生成失败，请重试。", "The reply failed to generate. Please try again.")}</span>
                        {canRegenerateMessage && (
                          <button
                            onClick={() => requestRegenerate(i)}
                            disabled={loading || hasStreamingContent}
                            className="shrink-0 px-2.5 py-1 rounded-lg bg-red-100 hover:bg-red-200 text-red-600 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {t("重新生成", "Regenerate")}
                          </button>
                        )}
                      </div>
                    )}

                    {!msg.isStreaming && !isFailedModelMessage && (
                      <div className={`msg-actions flex flex-wrap gap-1 mt-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-all duration-200 translate-y-1 group-hover:translate-y-0 group-focus-within:translate-y-0 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                        {msg.role === "model" && (hasParts || hasVisibleContent) && (
                          <div className="relative" ref={openExportMenuIndex === i ? exportMenuRef : null}>
                            <button onClick={() => setOpenExportMenuIndex(prev => prev === i ? null : i)} className="p-2 text-zinc-400 hover:text-primary hover:bg-primary/5 rounded-lg transition-colors" title={t("导出", "Export")} aria-label={t("导出消息", "Export message")}>
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
                            onClick={() => requestRegenerate(i)}
                            disabled={loading || hasStreamingContent}
                            className="p-2 text-zinc-400 hover:text-primary hover:bg-primary/5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-zinc-400"
                            title={t("重新生成", "Regenerate")}
                            aria-label={t("重新生成", "Regenerate")}
                          >
                            <RefreshCw size={16} />
                          </button>
                        ) : null}
                        {msg.role === "model" && buildCopyText(msg, locale).trim() && <ReplyActions text={buildCopyText(msg, locale)} />}
                        <button
                          onClick={() => handleCopyClick(i, msg)}
                          className={`p-2 rounded-lg transition-colors ${copiedIndex === i ? "text-emerald-500" : "text-zinc-400 hover:text-primary hover:bg-primary/5"}`}
                          title={t("复制内容", "Copy text")}
                          aria-label={t("复制内容", "Copy text")}
                        >
                          {copiedIndex === i ? <Check size={16} /> : <Copy size={16} />}
                        </button>
                        <button onClick={() => handleDeleteClick(i, msg.role)} className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title={t("删除", "Delete")} aria-label={t("删除消息", "Delete message")}><Trash2 size={16} /></button>
                        {msg.role === "user" && (
                          <button onClick={() => onStartEdit(i, msg)} className="p-2 text-zinc-400 hover:text-primary hover:bg-primary/5 rounded-lg transition-colors" title={t("编辑", "Edit")} aria-label={t("编辑消息", "Edit message")}><Edit3 size={16} /></button>
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
          <ResponsiveAIAvatar desktopSize={24} />
          <div className="msg-bubble-ai px-5 py-3.5">
            <LoadingSweepText text="..." className="loading-sweep-dots text-xl" />
          </div>
        </motion.div>
      )}

      <div ref={chatEndRef} />
    </div>
  );
}
