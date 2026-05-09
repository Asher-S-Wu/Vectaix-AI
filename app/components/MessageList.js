"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  Copy,
  Download,
  Edit3,
  Paperclip,
  Trash2,
  Type,
  User,
  X,
  Check,
} from "lucide-react";
import Markdown from "./Markdown";
import ThinkingBlock from "./ThinkingBlock";
import CouncilMessage from "./CouncilMessage";
import ImageLightbox from "./ImageLightbox";
import ConfirmModal from "./ConfirmModal";
import { useToast } from "./ToastProvider";
import { exportMessageContent } from "@/lib/client/messageExport";
import { getMessageImageSrc, isKeepableImageSrc } from "@/lib/shared/messageImage";
import { getMessageFileAttachments } from "@/lib/shared/messageAttachments";
import {
  AttachmentCard,
  AIAvatar,
  ResponsiveAIAvatar,
  buildCopyText,
  buildPlainText,
  normalizeCopiedText,
  isSelectionFullyInsideElement,
  Thumb,
  Citations,
  LoadingSweepText,
  ToolRunCards,
  ArtifactCards,
} from "./MessageListHelpers";
import {
  CHAT_MODELS,
  modelSupportsAvailableInput,
  isCouncilModel,
} from "@/lib/shared/models";
import {
  getWebBrowsingToolTitle,
  isWebBrowsingIdentifier,
  normalizeWebBrowsingIdentifier,
} from "@/lib/shared/webBrowsing";

const PENDING_RUN_TEXTS = new Set(["正在处理中...", "Council 正在处理中..."]);

const STARTER_PROMPTS = [
  { icon: "💡", title: "创意写作", description: "帮我写一个关于火星移民的科幻短篇开头" },
  { icon: "💻", title: "代码助手", description: "用 React 写一个带防抖功能的搜索框组件" },
  { icon: "🌍", title: "旅行规划", description: "制定一份去京都的 5 天文化深度游计划" },
  { icon: "📊", title: "数据分析", description: "如何通俗易懂地解释什么是‘量化宽松’？" },
];

function containsMarkdownTable(text) {
  if (typeof text !== "string") return false;
  const normalized = text.replace(/\r\n/g, "\n");
  return /\|.*\|[\t ]*\n[\t ]*\|?[\t ]*:?-{3,}:?[\t ]*(\|[\t ]*:?-{3,}:?[\t ]*)+\|?/u.test(normalized);
}

function isPendingRunText(text) {
  return typeof text === "string" && PENDING_RUN_TEXTS.has(text.trim());
}

function normalizeFallbackToolTimeline(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return [];

  return tools
    .filter((tool) => tool && typeof tool === "object" && typeof tool.id === "string" && tool.id)
    .map((tool) => {
      const apiName = typeof tool.apiName === "string" ? tool.apiName : "";
      const status = tool.status === "error" ? "error" : "done";
      const resultCount = Array.isArray(tool.state?.results) ? tool.state.results.length : undefined;
      const toolIdentifier = normalizeWebBrowsingIdentifier(tool.identifier);

      if (apiName === "search") {
        return {
          id: `timeline_${tool.id}`,
          kind: "search",
          status,
          query: typeof tool.arguments?.query === "string" ? tool.arguments.query : "",
          resultCount,
          message: typeof tool.content === "string" ? tool.content : "",
        };
      }

      if (apiName === "crawlSinglePage" || apiName === "crawlMultiPages") {
        const firstUrl = typeof tool.arguments?.url === "string" && tool.arguments.url
          ? tool.arguments.url
          : (
            Array.isArray(tool.arguments?.urls)
              ? tool.arguments.urls.find((item) => typeof item === "string" && item.trim())
              : ""
          ) || "";

        return {
          id: `timeline_${tool.id}`,
          kind: "reader",
          status,
          url: firstUrl,
          resultCount,
          message: typeof tool.content === "string" ? tool.content : "",
        };
      }

      return {
        id: `timeline_${tool.id}`,
        kind: "tool",
        status,
        content: typeof tool.title === "string" && tool.title
          ? tool.title
          : (isWebBrowsingIdentifier(toolIdentifier) ? getWebBrowsingToolTitle(apiName) : `${toolIdentifier || "tool"}.${tool.apiName || "run"}`),
        message: typeof tool.content === "string" ? tool.content : "",
      };
    })
    .filter(Boolean);
}

export default function MessageList({
  messages,
  loading,
  chatEndRef,
  listRef,
  onScroll,
  editingMsgIndex,
  editingContent,
  editingImageAction,
  editingImage,
  fontSizeClass,
  model,
  modelReady = true,
  onEditingContentChange,
  onEditingImageSelect,
  onEditingImageRemove,
  onEditingImageKeep,
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
  const editTextareaRef = useRef(null);
  const editFileInputRef = useRef(null);
  const exportMenuRef = useRef(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, index: null, role: null });
  const [openExportMenuIndex, setOpenExportMenuIndex] = useState(null);
  const prevMessagesRef = useRef([]);
  const isCouncilConversation = isCouncilModel(model);
  const canEditUserMessage = true;
  const canEditImages = modelSupportsAvailableInput(model, "image");
  const toast = useToast();
  const hasWaitingFirstChunk = messages.some((message) => message?.isWaitingFirstChunk);
  const hasStreamingContent = messages.some((message) => (message?.isStreaming && !message?.isWaitingFirstChunk) || message?.isSearching);
  const hasActiveConversationRun = messages.some((message) => message?.isStreaming === true);

  useEffect(() => {
    prevMessagesRef.current = messages;
  }, [messages]);

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
    setOpenExportMenuIndex(null);
  }, [messages]);

  const isNewMessage = (msg, index) => {
    const prevMsgs = prevMessagesRef.current;
    return !prevMsgs[index] || prevMsgs[index].id !== msg.id;
  };

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

  const handleEditFileSelect = (e) => {
    if (!canEditImages) return;
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      onEditingImageSelect?.({
        file,
        preview: ev.target?.result,
        name: file.name,
        mimeType: file.type,
      });
    };
    reader.readAsDataURL(file);
  };

  const hasEditingImage = () => {
    if (editingImageAction === "new") return Boolean(editingImage?.preview);
    if (editingImageAction === "keep") {
      const msg = messages?.[editingMsgIndex];
      return isKeepableImageSrc(getMessageImageSrc(msg));
    }
    return false;
  };

  const isEditingImageUploading = editingImageAction === "new" && editingImage?.uploadStatus === "uploading";

  const resizeEditTextarea = () => {
    const el = editTextareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 24)}px`;
  };

  const scrollEditIntoView = () => {
    const el = editTextareaRef.current;
    const container = listRef?.current;
    if (!el || !container) return;
    const elRect = el.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();
    const delta = elRect.top - (cRect.top + cRect.height / 2);
    container.scrollTo({ top: container.scrollTop + delta, behavior: "auto" });
  };

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
  }, [editingMsgIndex]);

  useEffect(() => {
    if (editingMsgIndex !== null && editingMsgIndex !== undefined) resizeEditTextarea();
  }, [editingContent, editingMsgIndex]);

  const handleBubbleCopy = (e) => {
    const el = e.currentTarget;
    if (!el || !isSelectionFullyInsideElement(el)) return;
    const selText = window.getSelection?.()?.toString?.();
    if (!selText) return;
    e.preventDefault();
    e.clipboardData?.setData("text/plain", normalizeCopiedText(selText));
  };

  const handleExportMessage = async (format, msg) => {
    const labelMap = { markdown: "Markdown", pdf: "PDF", docx: "Docx" };
    try {
      await exportMessageContent(format, buildCopyText(msg));
      toast.success(`已导出 ${labelMap[format] || "文件"}`);
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
      <ImageLightbox open={lightboxOpen} onClose={closeLightbox} src={lightboxSrc} />

      <ConfirmModal
        open={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, index: null, role: null })}
        onConfirm={handleConfirmDelete}
        title="删除消息"
        message={isCouncilConversation ? "确定要从这一轮开始删除吗？此操作会删除这一轮及其后所有轮次，无法撤销。" : `确定要删除这条${deleteConfirm.role === "user" ? "你的" : "AI"}消息吗？此操作无法撤销。`}
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
          <div className="h-full flex flex-col items-center justify-center space-y-10 text-center px-4 max-w-4xl mx-auto w-full">
            <div className="space-y-6">
              <motion.div 
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", damping: 15 }}
                className="relative inline-block"
              >
                <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full" />
                <AIAvatar model={model} size={72} animate={false} className="relative z-10" />
              </motion.div>
              <div className="space-y-3 relative z-10">
                <h2 className="text-3xl font-bold bg-gradient-to-b from-zinc-800 to-zinc-500 dark:from-white dark:to-zinc-400 bg-clip-text text-transparent tracking-tight">
                  今天能帮您做点什么？
                </h2>
                <p className="text-zinc-400 dark:text-zinc-500 text-[15px] max-w-sm mx-auto leading-relaxed">
                  选择一个模型开始对话
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl px-4">
              {STARTER_PROMPTS.map((prompt, idx) => (
                <motion.button
                  key={idx}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.1 }}
                  onClick={() => onSendStarterPrompt?.(prompt.description)}
                  className="flex flex-col items-start p-4 rounded-2xl glass-effect border-zinc-200/40 hover:border-primary/30 hover:bg-primary/5 transition-all text-left group active:scale-[0.98]"
                >
                  <span className="text-xl mb-2 group-hover:scale-110 transition-transform">{prompt.icon}</span>
                  <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 mb-1">{prompt.title}</span>
                  <span className="text-xs text-zinc-400 dark:text-zinc-500 line-clamp-1">{prompt.description}</span>
                </motion.button>
              ))}
            </div>
          </div>
        )
      ) : (
        messages.map((msg, i) => {
          const fallbackThinkingTimeline = normalizeFallbackToolTimeline(msg.tools);
          const displayParts = Array.isArray(msg.parts) && msg.role === "model"
            ? msg.parts.filter((part) => !(typeof part?.text === "string" && isPendingRunText(part.text)) && !part?.thought)
            : msg.parts;
          const hasParts = Array.isArray(displayParts) && displayParts.some((part) =>
            part?.inlineData?.url || part?.fileData?.name || (typeof part?.text === "string" && part.text.trim().length > 0)
          );
          const hasVisibleContent = typeof msg.content === "string" && msg.content.trim().length > 0 && !isPendingRunText(msg.content);
          const hasTableContent = (
            (hasVisibleContent && containsMarkdownTable(msg.content))
            || (hasParts && displayParts.some((part) => containsMarkdownTable(part?.text)))
          );
          const hasBodyOutput =
            hasVisibleContent
            || (hasParts && displayParts.some((part) => part && typeof part.text === "string" && part.text.trim().length > 0));
          const resolvedThinkingTimeline = Array.isArray(msg.thinkingTimeline) && msg.thinkingTimeline.length > 0
            ? msg.thinkingTimeline
            : fallbackThinkingTimeline;
          const hasThinkingTimeline = Array.isArray(resolvedThinkingTimeline)
            && resolvedThinkingTimeline.some((step) => step?.kind === "search" || step?.kind === "reader" || step?.kind === "sandbox" || step?.kind === "thought" || step?.kind === "upload" || step?.kind === "parse" || step?.kind === "tool" || step?.kind === "planner" || step?.kind === "writer");
          const hasCouncilExpertStates = Array.isArray(msg.councilExpertStates) && msg.councilExpertStates.length > 0;
          const hasCouncilAnalysis = msg.councilAnalysis && typeof msg.councilAnalysis === "object";
          const hasCouncilAnalysisState = msg.councilAnalysisState && typeof msg.councilAnalysisState === "object";
          const hasCouncilResultState = msg.councilResultState && typeof msg.councilResultState === "object";
          const shouldRenderCouncilMessage = isCouncilConversation && msg.role === "model" && (
            hasCouncilExpertStates
            || hasCouncilAnalysis
            || hasCouncilAnalysisState
            || hasCouncilResultState
            || Array.isArray(msg.councilExperts)
            || hasVisibleContent
            || msg.isStreaming
          );
          const hasToolRuns = Array.isArray(msg.tools) && msg.tools.length > 0;
          const hasArtifacts = Array.isArray(msg.artifacts) && msg.artifacts.length > 0;
          const shouldRenderToolCards = msg.role === "model" && hasToolRuns && !hasThinkingTimeline && msg.tools.some((t) => t?.id);
          const shouldRenderBubble = !shouldRenderCouncilMessage && (hasParts || hasVisibleContent || shouldRenderToolCards || (msg.role === "model" && hasArtifacts));
          
          if (msg.role === "model" && !msg.thought && !hasVisibleContent && !hasParts && !msg.isSearching && !msg.searchError && !hasThinkingTimeline && !hasCouncilExpertStates && !hasCouncilAnalysis && !hasCouncilAnalysisState && !hasCouncilResultState && !hasToolRuns && !hasArtifacts && msg.isWaitingFirstChunk) {
            return null;
          }

          return (
            <motion.div
              key={msg.id}
              initial={isNewMessage(msg, i) ? { opacity: 0, y: 20 } : false}
              animate={{ opacity: 1, y: 0 }}
              className={`flex flex-col gap-3 ${msg.role === "user" ? "items-end" : "items-start"} max-w-4xl mx-auto w-full group`}
            >
              {msg.role === "model" && !shouldRenderCouncilMessage && (msg.thought || hasVisibleContent || (msg.isStreaming && !msg.isWaitingFirstChunk) || hasParts || msg.isSearching || msg.searchError || hasThinkingTimeline || hasCouncilExpertStates || hasCouncilAnalysis || hasCouncilAnalysisState || hasCouncilResultState || hasToolRuns || hasArtifacts) && (
                <div className="flex items-center gap-2 pl-1">
                  <AIAvatar model={model} size={24} animate={msg.isStreaming} />
                  <span className="text-[11px] text-zinc-400 font-bold tracking-wider">
                    {CHAT_MODELS.find((m) => m.id === model)?.name}
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
                      <img src={userAvatar} alt="" className="w-5 h-5 rounded-md object-cover ring-1 ring-zinc-200/50" />
                    ) : (
                      <div className="w-5 h-5 rounded-md bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-[10px] font-bold text-zinc-500">
                        {userNickname?.[0] || "您"}
                      </div>
                    )}
                  </div>
                )}
                {shouldRenderCouncilMessage ? (
                  <CouncilMessage
                    content={typeof msg.content === "string" ? msg.content : ""}
                    councilExperts={msg.councilExperts}
                    councilExpertStates={msg.councilExpertStates}
                    councilAnalysis={msg.councilAnalysis}
                    councilAnalysisState={msg.councilAnalysisState}
                    councilResultState={msg.councilResultState}
                  />
                ) : null}

                {msg.role === "model" && !shouldRenderCouncilMessage && (msg.thought || msg.isSearching || msg.searchError || hasThinkingTimeline || hasCouncilExpertStates || hasCouncilAnalysisState || hasCouncilResultState) && (
                  <ThinkingBlock
                    thought={msg.thought}
                    isStreaming={msg.isThinkingStreaming}
                    isSearching={msg.isSearching}
                    searchQuery={msg.searchQuery}
                    searchError={msg.searchError}
                    timeline={resolvedThinkingTimeline}
                    councilExpertStates={msg.councilExpertStates}
                    councilSummaryState={msg.councilResultState}
                    councilExperts={msg.councilExperts}
                    tools={msg.tools}
                    bodyText={hasBodyOutput ? "1" : ""}
                    showThoughtDetails={!isCouncilConversation}
                  />
                )}

                {editingMsgIndex === i && msg.role === "user" && canEditUserMessage ? (
                  <div className="w-full flex flex-col items-end gap-2">
                    <div className="msg-bubble-user w-full max-w-full glass-effect !bg-white dark:!bg-zinc-800 border-primary/20">
                      <textarea
                        ref={editTextareaRef}
                        value={editingContent}
                        onChange={(e) => onEditingContentChange(e.target.value)}
                        className="block w-full max-h-[45vh] resize-none overflow-y-auto fade-scrollbar bg-transparent p-0 text-sm leading-6 text-zinc-800 dark:text-zinc-100 outline-none"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={onCancelEdit} className="px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100 rounded-lg">取消</button>
                      <button onClick={() => onSubmitEdit(i)} className="px-3 py-1.5 text-xs text-white bg-primary rounded-lg">提交</button>
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
                                if (url) return <Thumb key={idx} src={url} onClick={openLightbox} />;
                                if (part?.fileData?.name) return <AttachmentCard key={idx} file={part.fileData} compact={isUser} />;
                                if (part?.text?.trim()) {
                                  return (
                                    <Markdown
                                      key={idx}
                                      enableHighlight={!msg.isStreaming}
                                      enableMath={true}
                                      className={isUser ? "prose-invert" : ""}
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
                          <Markdown
                            enableHighlight={!msg.isStreaming}
                            enableMath={true}
                            className={msg.role === "user" ? "prose-invert" : ""}
                          >
                            {msg.content}
                          </Markdown>
                        ) : null}
                        {shouldRenderToolCards && <ToolRunCards tools={msg.tools} />}
                        {msg.role === "model" && hasArtifacts && <ArtifactCards artifacts={msg.artifacts} />}
                        {msg.role === "model" && !msg.isStreaming && msg.citations && <Citations citations={msg.citations} />}
                      </div>
                    )}

                    {!msg.isStreaming && (
                      <div className={`flex flex-wrap gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-all duration-200 translate-y-1 group-hover:translate-y-0 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                        {msg.role === "model" && (hasParts || hasVisibleContent) && (
                          <div className="relative" ref={openExportMenuIndex === i ? exportMenuRef : null}>
                            <button onClick={() => setOpenExportMenuIndex(prev => prev === i ? null : i)} className="p-1.5 text-zinc-400 hover:text-primary hover:bg-primary/5 rounded-lg">
                              <Download size={14} />
                            </button>
                            <AnimatePresence>
                              {openExportMenuIndex === i && (
                                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} className="absolute right-0 top-full z-20 mt-1 min-w-[150px] rounded-xl glass-effect border-zinc-200/50 p-1.5 shadow-lg">
                                  {["markdown", "pdf", "docx"].map(format => (
                                    <button key={format} onClick={() => handleExportMessage(format, msg)} className="w-full text-left px-3 py-2 text-sm hover:bg-primary/5 rounded-lg uppercase">{format}</button>
                                  ))}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        )}
                        <button onClick={() => onCopy(buildCopyText(msg))} className="p-1.5 text-zinc-400 hover:text-primary hover:bg-primary/5 rounded-lg"><Copy size={14} /></button>
                        <button onClick={() => handleDeleteClick(i, msg.role)} className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 size={14} /></button>
                        {msg.role === "user" && canEditUserMessage && (
                          <button onClick={() => onStartEdit(i, msg)} className="p-1.5 text-zinc-400 hover:text-primary hover:bg-primary/5 rounded-lg"><Edit3 size={14} /></button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          );
        })
      )}

      {messages.length > 0 && (loading || hasWaitingFirstChunk) && !hasStreamingContent && (
        <div className="flex gap-3 items-start max-w-4xl mx-auto w-full">
          <ResponsiveAIAvatar model={model} desktopSize={24} animate />
          <div className="px-5 py-3 glass-effect rounded-2xl shadow-sm">
            <LoadingSweepText text="..." className="loading-sweep-dots text-xl" />
          </div>
        </div>
      )}

      <div ref={chatEndRef} />
    </div>
  );
}
