import { buildChatConfig } from "@/lib/client/chat/chatConfig";
import { playCompletionSound, unlockCompletionSound } from "@/lib/client/chat/completionSound";
import { buildPersistedConversationMessages, mergeLocalImagePreviews, stripLocalImagePreviews } from "@/lib/client/chat/messagePersistence";
import { getModelConfig, isMediaGenerationModel } from "@/lib/shared/models";

function isUnauthorizedError(errorMessage) {
  if (typeof errorMessage !== "string") return false;
  const lower = errorMessage.toLowerCase();
  return lower.includes("401") || lower.includes("unauthorized");
}

function isConversationMissingError(errorMessage) {
  if (typeof errorMessage !== "string") return false;
  const normalized = errorMessage.trim().toLowerCase();
  return (
    normalized === "not found" ||
    normalized === "invalid id" ||
    normalized.includes("conversation not found") ||
    normalized.includes("会话不存在")
  );
}

function isUpstreamRouteMissingError(errorMessage) {
  if (typeof errorMessage !== "string") return false;
  const lower = errorMessage.toLowerCase();
  return /\b404\b.*page not found/.test(lower);
}

export { buildChatConfig, buildPersistedConversationMessages, unlockCompletionSound };

const generateMessageId = () => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export async function runChat({
  prompt,
  historyMessages,
  conversationId,
  model,
  config,
  currentConversationId,
  setCurrentConversationId,
  fetchConversations,
  setMessages,
  setLoading,
  signal,
  mode,
  messagesForRegenerate,
  settings,
  completionSoundVolume,
  refusalRestoreMessages,
  onSensitiveRefusal,
  onError,
  onUnauthorized,
  onConversationMissing,
  userMessageId,
  targetMessageId,
}) {
  // 在函数开头声明，确保在整个函数范围内可用
  let newConvId = null;
  const provider = getModelConfig(model)?.provider || "";

  const historyPayload = historyMessages.map((m) => ({
    ...(m.id ? { id: m.id } : {}),
    role: m.role,
    content: m.content,
    parts: stripLocalImagePreviews(m.parts),
    ...(m.providerState ? { providerState: m.providerState } : {}),
  }));

  const modelMessageId = generateMessageId();

  const payload = {
    prompt,
    model,
    config,
    history: historyPayload,
    conversationId,
    ...(mode ? { mode } : {}),
    ...(mode === "regenerate" ? { messages: buildPersistedConversationMessages(messagesForRegenerate) } : {}),
    ...(!conversationId && settings ? { settings } : {}),
    ...(userMessageId ? { userMessageId } : {}),
    modelMessageId: targetMessageId || modelMessageId,
  };

  const syncConversationMessages = async (convId, nextMessages) => {
    if (!convId || !Array.isArray(nextMessages)) return;
    try {
      const persistedMessages = buildPersistedConversationMessages(nextMessages);
      await fetch(`/api/conversations/${convId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: persistedMessages }),
        }
      );
    } catch { }
  };

  const restoreRegenerateMessages = async (convId) => {
    if (mode !== "regenerate" || !Array.isArray(refusalRestoreMessages)) {
      return false;
    }
    setMessages(refusalRestoreMessages);
    await syncConversationMessages(convId, refusalRestoreMessages);
    return true;
  };

  const removePendingUserMessage = (messagesList) => {
    if (!Array.isArray(messagesList) || messagesList.length === 0) return messagesList;
    const next = messagesList.slice();

    if (typeof userMessageId === "string" && userMessageId) {
      const targetIndex = next.findIndex((msg) => msg?.id === userMessageId);
      if (targetIndex >= 0) {
        next.splice(targetIndex, 1);
        return next;
      }
    }

    const hasPromptText = typeof prompt === "string" && prompt.trim();
    for (let i = next.length - 1; i >= 0; i -= 1) {
      const msg = next[i];
      if (msg?.role !== "user") continue;
      if (hasPromptText) {
        if (msg?.content === prompt) {
          next.splice(i, 1);
          break;
        }
      } else if (typeof msg?.content === "string" && msg.content.trim() === "") {
        next.splice(i, 1);
        break;
      }
    }
    return next;
  };

  setLoading(true);
  let streamMsgId = modelMessageId;
  let conversationActivated = false;

  const ensureConversationActivated = () => {
    if (conversationActivated) return;
    if (!newConvId || currentConversationId) {
      conversationActivated = true;
      return;
    }
    conversationActivated = true;
    setCurrentConversationId(newConvId);
    fetchConversations();
  };

  const rollbackPendingTurn = async (convId) => {
    let nextMessagesForSync = null;
    setMessages((prev) => {
      if (!Array.isArray(prev) || prev.length === 0) return prev;
      let next = prev;
      if (streamMsgId !== null) {
        next = next.filter((msg) => msg.id !== streamMsgId);
      }
      next = removePendingUserMessage(next);
      nextMessagesForSync = next;
      return next;
    });
    await syncConversationMessages(convId, nextMessagesForSync);
    if (newConvId) {
      setCurrentConversationId((prevId) => (prevId === newConvId ? null : prevId));
      fetchConversations();
    }
    streamMsgId = null;
  };

  try {
    const res = await fetch(isMediaGenerationModel(model) ? "/api/chat/media" : "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });

    if (!res.ok) {
      let errorMessage = res.statusText;
      try {
        const errorData = await res.json();
        errorMessage = errorData.error;
      } catch { }

      const responseError = new Error(errorMessage);
      responseError.httpStatus = res.status;
      throw responseError;
    }


    newConvId = res.headers.get("X-Conversation-Id");
    if (newConvId && !currentConversationId) {
      ensureConversationActivated();
    }

    let _inheritedCitations = null;
    let _inheritedTools = null;

    setMessages((prev) => {
      const targetId = targetMessageId || streamMsgId;
      const existing = prev.find((item) => item?.id === targetId);
      _inheritedCitations = Array.isArray(existing?.citations) ? existing.citations : null;
      _inheritedTools = Array.isArray(existing?.tools) ? existing.tools : null;
      const nextStreamingState = {
        role: "model",
        content: "",
        type: "text",
        id: targetId,
        isStreaming: true,
        isThinkingStreaming: true,
        isWaitingFirstChunk: true,
        thought: "",
        isSearching: false,
        thinkingTimeline: [],
        citations: null,
        tools: null,
        searchError: null,
      };
      const index = prev.findIndex((item) => item?.id === targetId);
      if (index >= 0) {
        const next = prev.slice();
        next[index] = {
          ...prev[index],
          ...nextStreamingState,
          thinkingTimeline: Array.isArray(prev[index]?.thinkingTimeline) ? prev[index].thinkingTimeline : nextStreamingState.thinkingTimeline,
          citations: prev[index]?.citations || nextStreamingState.citations,
          tools: Array.isArray(prev[index]?.tools) ? prev[index].tools : nextStreamingState.tools,
          thought: "",
          content: prev[index]?.content || "",
          parts: prev[index]?.parts,
        };
        streamMsgId = targetId;
        return next;
      }
      streamMsgId = targetId;
      return [...prev, nextStreamingState];
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let done = false;
    let fullText = "";
    let displayedText = "";
    let fullThought = "";
    let buffer = "";
    let thinkingEnded = false;
    let sawDone = false;
    const convIdForSync = newConvId || currentConversationId || conversationId;

    let flushScheduled = false;
    let hasReceivedContent = false;
    let isSearching = false;
    let searchQuery = null;
    let citations = null;
    let searchError = null;
    let streamErrorMessage = null; // 流内错误消息（来自 stream_error 事件）
    let thinkingTimeline = [];
    let generatedParts = null;
    let generatedProviderState = null;
    let timelineStepSeq = 0;

    const nextTimelineId = () => `timeline_${Date.now()}_${++timelineStepSeq}`;

    const updateThinkingTimeline = (updater) => {
      const base = Array.isArray(thinkingTimeline) ? thinkingTimeline : [];
      const next = updater(base);
      if (Array.isArray(next)) {
        thinkingTimeline = next;
      }
    };

    const appendTimelineStep = (step) => {
      if (!step || typeof step !== "object") return;
      updateThinkingTimeline((prev) => [...prev, { id: nextTimelineId(), ...step }]);
    };

    const getLastTimelineStep = () => {
      if (!Array.isArray(thinkingTimeline) || thinkingTimeline.length === 0) return null;
      return thinkingTimeline[thinkingTimeline.length - 1] || null;
    };

    const ensureSyntheticThoughtRunning = () => {
      const last = getLastTimelineStep();
      if (last?.kind === "thought" && last?.status === "streaming") return;
      appendTimelineStep({
        kind: "thought",
        status: "streaming",
        content: "",
        synthetic: true,
      });
    };

    const patchLastRunningStep = (kind, patch) => {
      let updated = false;
      updateThinkingTimeline((prev) => {
        for (let i = prev.length - 1; i >= 0; i -= 1) {
          const item = prev[i];
          if (item?.kind === kind && item?.status === "running") {
            const next = prev.slice();
            next[i] = { ...item, ...patch };
            updated = true;
            return next;
          }
        }
        return prev;
      });
      return updated;
    };

    const appendThoughtStep = (deltaText) => {
      if (typeof deltaText !== "string" || !deltaText) return;
      updateThinkingTimeline((prev) => {
        if (prev.length > 0) {
          const last = prev[prev.length - 1];
          if (last?.kind === "thought" && (last?.status === "streaming" || last?.synthetic)) {
            const next = prev.slice();
            next[next.length - 1] = {
              ...last,
              synthetic: false,
              status: "streaming",
              content: `${typeof last.content === "string" ? last.content : ""}${deltaText}`,
            };
            return next;
          }
        }
        return [...prev, { id: nextTimelineId(), kind: "thought", status: "streaming", content: deltaText, synthetic: false }];
      });
    };

    const closeStreamingThoughtSteps = () => {
      updateThinkingTimeline((prev) => {
        let changed = false;
        const next = prev.map((item) => {
          if (
            (item?.kind === "thought" && item?.status === "streaming")
            || ((item?.kind === "image_gen" || item?.kind === "video_gen") && item?.status === "running")
          ) {
            changed = true;
            return { ...item, status: "done" };
          }
          return item;
        });
        return changed ? next : prev;
      });
    };

    const flushStreamingMessage = () => {
      flushScheduled = false;
      setMessages((prev) => {
        if (!Array.isArray(prev) || prev.length === 0) return prev;

        const lastIdx = prev.length - 1;
        const isLast = prev[lastIdx]?.id === streamMsgId;
        const idx = isLast ? lastIdx : prev.findIndex((m) => m?.id === streamMsgId);
        if (idx < 0) return prev;

        const base = prev[idx];
        const nowHasContent =
          displayedText.length > 0 ||
          fullThought.length > 0 ||
          isSearching ||
          searchError ||
          (Array.isArray(generatedParts) && generatedParts.length > 0) ||
          (Array.isArray(thinkingTimeline) && thinkingTimeline.length > 0);
        if (nowHasContent && !hasReceivedContent) {
          hasReceivedContent = true;
        }
        const nextMsg = {
          ...base,
          content: displayedText,
          parts: Array.isArray(generatedParts) && generatedParts.length > 0
            ? generatedParts
            : (displayedText.length > 0 ? [{ text: displayedText }] : base.parts),
          ...(generatedProviderState ? { providerState: generatedProviderState } : {}),
          thought: fullThought,
          isThinkingStreaming: !thinkingEnded,
          isWaitingFirstChunk: !hasReceivedContent,
          isSearching,
          thinkingTimeline,
          citations,
          searchError,
        };
        if (
          base.content === nextMsg.content &&
          base.thought === nextMsg.thought &&
          base.isThinkingStreaming === nextMsg.isThinkingStreaming &&
          base.isWaitingFirstChunk === nextMsg.isWaitingFirstChunk &&
          base.isSearching === nextMsg.isSearching &&
          base.parts === nextMsg.parts &&
          base.providerState === nextMsg.providerState &&
          base.thinkingTimeline === nextMsg.thinkingTimeline &&
          base.citations === nextMsg.citations &&
          base.tools === nextMsg.tools &&
          base.searchError === nextMsg.searchError
        ) {
          return prev;
        }

        const next = prev.slice();
        next[idx] = nextMsg;
        return next;
      });
    };

    const scheduleFlush = () => {
      if (flushScheduled) return;
      flushScheduled = true;
      setTimeout(flushStreamingMessage, 0);
    };

    const applyEventPayload = (payload) => {
      const p = payload.trim();
      if (!p) return;
      if (p === "[DONE]") {
        sawDone = true;
        isSearching = false;
        patchLastRunningStep("search", { status: "done" });
        patchLastRunningStep("reader", { status: "done" });
        closeStreamingThoughtSteps();
        displayedText = fullText;
        scheduleFlush();
        return;
      }
      try {
        const data = JSON.parse(p);
        if (data.type === "thought") {
          const delta = typeof data.content === "string" ? data.content : "";
          fullThought += delta;
          appendThoughtStep(delta);
        } else if (data.type === "text") {
          const delta = typeof data.content === "string" ? data.content : "";
          fullText += delta;
          displayedText = fullText;
          if (!thinkingEnded) {
            ensureSyntheticThoughtRunning();
            thinkingEnded = true;
            closeStreamingThoughtSteps();
          }
          isSearching = false;
          scheduleFlush();
        } else if (data.type === "search_start") {
          isSearching = true;
          const query = typeof data.query === "string" ? data.query.trim() : "";
          const round = Number.isFinite(data.round) ? data.round : null;
          if (query) searchQuery = query;
          ensureSyntheticThoughtRunning();
          closeStreamingThoughtSteps();
          appendTimelineStep({
            kind: "search",
            status: "running",
            ...(round ? { round } : {}),
            query: query || "（空检索词）",
          });
          searchError = null;
          scheduleFlush();
        } else if (data.type === "search_result") {
          isSearching = false;
          const query = typeof data.query === "string" ? data.query.trim() : "";
          const round = Number.isFinite(data.round) ? data.round : null;
          const resultCount = Array.isArray(data.results) ? data.results.length : null;
          if (query) searchQuery = query;
          const updated = patchLastRunningStep("search", {
            status: "done",
            ...(round ? { round } : {}),
            query: query || undefined,
            resultCount: Number.isFinite(resultCount) ? resultCount : undefined,
          });
          if (!updated) {
            appendTimelineStep({
              kind: "search",
              status: "done",
              ...(round ? { round } : {}),
              query: query || "（空检索词）",
              ...(Number.isFinite(resultCount) ? { resultCount } : {}),
            });
          }
          if (!thinkingEnded) ensureSyntheticThoughtRunning();
          scheduleFlush();
        } else if (data.type === "search_error") {
          isSearching = false;
          const query = typeof data.query === "string" ? data.query.trim() : "";
          const round = Number.isFinite(data.round) ? data.round : null;
          const message = typeof data.message === "string" && data.message.trim()
            ? data.message.trim()
            : "联网搜索失败，请稍后再试";
          const updated = patchLastRunningStep("search", {
            status: "error",
            ...(round ? { round } : {}),
            query: query || undefined,
            message,
          });
          if (!updated) {
            appendTimelineStep({
              kind: "search",
              status: "error",
              ...(round ? { round } : {}),
              query: query || searchQuery || "（空检索词）",
              message,
            });
          }
          searchError = message;
          if (!thinkingEnded) ensureSyntheticThoughtRunning();
          scheduleFlush();
        } else if (data.type === "page_fetch_start") {
          isSearching = true;
          const url = typeof data.url === "string" ? data.url.trim() : "";
          const round = Number.isFinite(data.round) ? data.round : null;
          ensureSyntheticThoughtRunning();
          closeStreamingThoughtSteps();
          appendTimelineStep({
            kind: "reader",
            status: "running",
            ...(round ? { round } : {}),
            url,
          });
          searchError = null;
          scheduleFlush();
        } else if (data.type === "page_fetch_result") {
          isSearching = false;
          const url = typeof data.url === "string" ? data.url.trim() : "";
          const round = Number.isFinite(data.round) ? data.round : null;
          const resultCount = Array.isArray(data.results) ? data.results.length : null;
          const updated = patchLastRunningStep("reader", {
            status: "done",
            ...(round ? { round } : {}),
            url: url || undefined,
            resultCount: Number.isFinite(resultCount) ? resultCount : undefined,
          });
          if (!updated) {
            appendTimelineStep({
              kind: "reader",
              status: "done",
              ...(round ? { round } : {}),
              url,
              ...(Number.isFinite(resultCount) ? { resultCount } : {}),
            });
          }
          if (!thinkingEnded) ensureSyntheticThoughtRunning();
          scheduleFlush();
        } else if (data.type === "page_fetch_error") {
          isSearching = false;
          const url = typeof data.url === "string" ? data.url.trim() : "";
          const round = Number.isFinite(data.round) ? data.round : null;
          const message = typeof data.message === "string" && data.message.trim()
            ? data.message.trim()
            : "网页获取失败，请稍后再试";
          const updated = patchLastRunningStep("reader", {
            status: "error",
            ...(round ? { round } : {}),
            url: url || undefined,
            message,
          });
          if (!updated) {
            appendTimelineStep({
              kind: "reader",
              status: "error",
              ...(round ? { round } : {}),
              url,
              message,
            });
          }
          if (!thinkingEnded) ensureSyntheticThoughtRunning();
          scheduleFlush();
        } else if (data.type === "citations") {
          citations = Array.isArray(data.citations) ? data.citations : null;
          scheduleFlush();
        } else if (data.type === "image_gen_start") {
          appendTimelineStep({
            kind: "image_gen",
            status: "running",
            content: "正在生成图片…",
            synthetic: false,
          });
          scheduleFlush();
        } else if (data.type === "image_gen_progress") {
          updateThinkingTimeline((prev) => {
            if (prev.length === 0) return prev;
            const last = prev[prev.length - 1];
            if (last?.kind === "image_gen" && last?.status === "running") {
              const next = prev.slice();
              const progressText = typeof data.progress === "number" && data.progress > 0 ? ` (${data.progress}%)` : "";
              next[next.length - 1] = { ...last, content: `正在生成图片…${progressText}` };
              return next;
            }
            return prev;
          });
          scheduleFlush();
        } else if (data.type === "image_gen_complete") {
          closeStreamingThoughtSteps();
          thinkingEnded = true;
          fullText = "";
          displayedText = "";
          generatedParts = Array.isArray(data.parts) ? data.parts : null;
          generatedProviderState = data.providerState && typeof data.providerState === "object"
            ? data.providerState
            : null;
          scheduleFlush();
        } else if (data.type === "image_gen_error") {
          closeStreamingThoughtSteps();
          thinkingEnded = true;
          streamErrorMessage = typeof data.message === "string" ? data.message : "图片生成失败";
          scheduleFlush();
        } else if (data.type === "video_gen_start") {
          appendTimelineStep({
            kind: "video_gen",
            status: "running",
            content: "正在生成视频…",
            synthetic: false,
          });
          scheduleFlush();
        } else if (data.type === "video_gen_progress") {
          updateThinkingTimeline((prev) => {
            if (prev.length === 0) return prev;
            const last = prev[prev.length - 1];
            if (last?.kind === "video_gen" && last?.status === "running") {
              const next = prev.slice();
              const progressText = typeof data.progress === "number" && data.progress > 0 ? ` (${data.progress}%)` : "";
              next[next.length - 1] = { ...last, content: `正在生成视频…${progressText}` };
              return next;
            }
            return prev;
          });
          scheduleFlush();
        } else if (data.type === "video_gen_complete") {
          closeStreamingThoughtSteps();
          thinkingEnded = true;
          fullText = "";
          displayedText = "";
          generatedParts = Array.isArray(data.parts) ? data.parts : null;
          generatedProviderState = data.providerState && typeof data.providerState === "object"
            ? data.providerState
            : null;
          scheduleFlush();
        } else if (data.type === "video_gen_error") {
          closeStreamingThoughtSteps();
          thinkingEnded = true;
          streamErrorMessage = typeof data.message === "string" ? data.message : "视频生成失败";
          scheduleFlush();
        } else if (data.type === "stream_error") {
          // 流内错误：记录错误信息，后续在主循环中处理
          streamErrorMessage = typeof data.message === "string" ? data.message : "Unknown stream error";
        }
      } catch {
        return;
      }
    };

    const consumeSseBuffer = (final = false) => {
      // 兼容 \n\n 和 \r\n\r\n 的分隔
      const blocks = buffer.split(/\r?\n\r?\n/);
      if (!final) buffer = blocks.pop();
      else buffer = "";

      for (const block of blocks) {
        const trimmedBlock = block.trim();
        if (!trimmedBlock) continue;

        // SSE 允许多行 data:，需要合并
        const lines = trimmedBlock.split(/\r?\n/);
        const dataLines = [];
        for (const line of lines) {
          if (!line) continue;
          if (line.startsWith(":")) continue; // comment/heartbeat
          if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).replace(/^\s*/, ""));
          }
        }
        if (!dataLines.length) continue;
        applyEventPayload(dataLines.join("\n"));
      }
    };

    while (!done) {
      const { value, done: doneReading } = await reader.read();
      done = doneReading;
      if (signal?.aborted) break;
      if (value) buffer += decoder.decode(value, { stream: true });
      consumeSseBuffer(false);

      if (signal?.aborted) break;
      scheduleFlush();
    }

    // flush TextDecoder / 最后一段 buffer（避免最后一个事件未以空行结尾时被漏掉）
    buffer += decoder.decode();
    consumeSseBuffer(true);
    displayedText = fullText;
    flushStreamingMessage();

    // 检查流内错误（AI API 在流式传输过程中报错，如上下文超出）
    if (streamErrorMessage && fullText.trim() === "") {
      // 移除正在流式输出的空消息
      if (streamMsgId !== null) {
        setMessages((prev) => prev.filter((msg) => msg.id !== streamMsgId));
        streamMsgId = null;
      }
      throw new Error(streamErrorMessage);
    }

    const isGeminiRefusal =
      provider === "gemini" &&
      !signal?.aborted &&
      sawDone &&
      fullText.trim() === "" &&
      fullThought.trim() === "" &&
      (!citations || citations.length === 0);

    if (isGeminiRefusal) {
    const convIdForSync = newConvId || currentConversationId || conversationId;
      let nextMessagesForSync = null;
      if (Array.isArray(refusalRestoreMessages)) {
        setMessages(refusalRestoreMessages);
        nextMessagesForSync = refusalRestoreMessages;
      } else {
        setMessages((prev) => {
          if (!Array.isArray(prev) || prev.length === 0) return prev;
          let next = prev.filter((msg) => msg.id !== streamMsgId);
          const hasPromptText = typeof prompt === "string" && prompt.trim();
          if (hasPromptText) {
            for (let i = next.length - 1; i >= 0; i -= 1) {
              const msg = next[i];
              if (msg?.role === "user" && msg?.content === prompt) {
                next.splice(i, 1);
                break;
              }
            }
          } else {
            for (let i = next.length - 1; i >= 0; i -= 1) {
              const msg = next[i];
              if (msg?.role === "user" && typeof msg?.content === "string" && msg.content.trim() === "") {
                next.splice(i, 1);
                break;
              }
            }
          }
          nextMessagesForSync = next;
          return next;
        });
      }

      if (convIdForSync && Array.isArray(nextMessagesForSync)) {
        await syncConversationMessages(convIdForSync, nextMessagesForSync);
      }

      const shouldPrefill = mode !== "regenerate" && !Array.isArray(refusalRestoreMessages);
      onSensitiveRefusal?.({ prompt, shouldPrefill });
      return;
    }

    if (!signal?.aborted && (sawDone || fullText.length > 0)) {
      await playCompletionSound(completionSoundVolume);
    }

    // 流式结束后做一次"最终对齐"：移动端偶发断流/缓冲时，避免必须刷新才能看到完整内容
    if (!signal?.aborted && sawDone && convIdForSync) {
      (async () => {
        try {
          const convRes = await fetch(`/api/conversations/${convIdForSync}`);
          if (!convRes.ok) return;
          const data = await convRes.json();
          const serverMessages = data?.conversation?.messages;
          if (!Array.isArray(serverMessages)) return;

          const lastModelLen = (arr) => {
            for (let i = arr.length - 1; i >= 0; i -= 1) {
              if (arr[i]?.role === "model") return arr[i]?.content.length;
            }
            return 0;
          };

          // 将 thinkingTimeline 回写到服务器，使切换对话后能恢复完整流程展示
          const hasTimelineToSave = Array.isArray(thinkingTimeline) && thinkingTimeline.length > 0;
          if (hasTimelineToSave) {
            const nextMsgs = serverMessages.slice();
            let patched = false;
            for (let i = nextMsgs.length - 1; i >= 0; i -= 1) {
              if (nextMsgs[i]?.role === "model") {
                nextMsgs[i] = { ...nextMsgs[i], thinkingTimeline };
                patched = true;
                break;
              }
            }
            if (patched) {
              await syncConversationMessages(convIdForSync, nextMsgs);
            }
          }

          setMessages((prev) => {
            const idx = prev.findIndex((m) => m?.id === streamMsgId);
            // 如果用户已经发了下一条消息，就不要覆盖，避免竞态把新消息"抹掉"
            if (idx !== -1 && idx !== prev.length - 1) return prev;
            if (lastModelLen(serverMessages) < lastModelLen(prev)) return prev;
            const streamMsg = idx >= 0 ? prev[idx] : null;
            const streamTimeline = Array.isArray(streamMsg?.thinkingTimeline)
              ? streamMsg.thinkingTimeline
              : null;
            const streamTools = Array.isArray(streamMsg?.tools)
              ? streamMsg.tools
              : null;
            const streamCitations = Array.isArray(streamMsg?.citations)
              ? streamMsg.citations
              : null;
            const streamSearchError = typeof streamMsg?.searchError === "string"
              ? streamMsg.searchError
              : null;

            // 保留流式消息的 id，避免 MessageList key 变化导致整条气泡重新挂载（framer-motion 入场动画 => "闪一下"）
            if (streamMsgId != null) {
              const next = serverMessages.slice();
              for (let i = next.length - 1; i >= 0; i -= 1) {
                if (next[i]?.role === "model") {
                  next[i] = {
                    ...next[i],
                    id: streamMsgId,
                    ...(streamTimeline?.length ? { thinkingTimeline: streamTimeline } : {}),
                    ...(streamCitations?.length ? { citations: streamCitations } : {}),
                    ...(streamTools?.length ? { tools: streamTools } : {}),
                    ...(streamSearchError ? { searchError: streamSearchError } : {}),
                  };
                  break;
                }
              }

              // 同步上一条用户消息的 id，避免"上一条气泡"闪烁
              if (prev.length >= 2 && next.length >= 2) {
                const prevLast = prev[prev.length - 1];
                const prevPrev = prev[prev.length - 2];
                const nextPrev = next[next.length - 2];
                if (
                  prevLast?.id === streamMsgId &&
                  prevPrev?.role === "user" &&
                  prevPrev?.id != null &&
                  nextPrev?.role === "user" &&
                  typeof prevPrev?.content === "string" &&
                  prevPrev.content === nextPrev?.content
                ) {
                  next[next.length - 2] = mergeLocalImagePreviews({ ...nextPrev, id: prevPrev.id }, prevPrev);
                }
              }

              return next;
            }

            return serverMessages;
          });
        } catch {
          // ignore
        }
      })();
    }

  } catch (err) {
    const isAbortError = err?.name === "AbortError";
    const convIdForSync = newConvId || currentConversationId || conversationId;

    if (isAbortError) {
      const restored = await restoreRegenerateMessages(convIdForSync);
      if (restored) {
        streamMsgId = null;
      } else {
        await rollbackPendingTurn(convIdForSync);
      }
    } else {
      const errMsg = err?.message;
      const normalizedErrMsg = typeof errMsg === "string" ? errMsg.trim() : "";
      const lowerErrMsg = normalizedErrMsg.toLowerCase();
      const errorStatus = typeof err?.httpStatus === "number" ? err.httpStatus : undefined;
      const isUnauthorized = errorStatus === 401;
      const isProviderUnauthorized = !isUnauthorized && isUnauthorizedError(errMsg);
      const isConversationMissing = (
        errorStatus === 404 ||
        (errorStatus === 400 && typeof errMsg === "string" && errMsg.trim().toLowerCase() === "invalid id")
      ) && isConversationMissingError(errMsg);
      const isUpstreamRouteMissing = isUpstreamRouteMissingError(errMsg);

      // 根据错误类型给出准确的提示
      let errorMessage;
      if (
        lowerErrMsg.includes("failed to fetch")
        || lowerErrMsg.includes("fetch failed")
        || lowerErrMsg.includes("networkerror")
        || lowerErrMsg.includes("network")
      ) {
        errorMessage = "网络连接失败，请检查网络后重试";
      } else if (
        normalizedErrMsg.includes("rate limit")
        || normalizedErrMsg.includes("429")
        || lowerErrMsg.includes("too many request")
      ) {
        errorMessage = "请求过于频繁，请稍后再试";
      } else if (isUnauthorized) {
        errorMessage = "登录已过期，请刷新页面重新登录";
      } else if (isProviderUnauthorized) {
        errorMessage = "模型服务认证失败，请稍后再试";
      } else if (isConversationMissing) {
        errorMessage = "当前对话已失效，已切回新对话，请重新发送消息";
      } else if (isUpstreamRouteMissing) {
        errorMessage = "模型服务接口异常，请稍后再试";
      } else if (normalizedErrMsg.includes("500") || normalizedErrMsg.includes("Internal Server Error")) {
        errorMessage = "服务器内部错误，请稍后再试";
      } else if (normalizedErrMsg.includes("503") || normalizedErrMsg.includes("Service Unavailable")) {
        errorMessage = "服务暂时不可用，请稍后再试";
      } else if (normalizedErrMsg) {
        // 有具体错误信息时直接显示
        errorMessage = normalizedErrMsg;
      } else {
        errorMessage = "请求失败，请重试";
      }
      if (mode === "regenerate" && Array.isArray(refusalRestoreMessages)) {
        await restoreRegenerateMessages(convIdForSync);
      } else {
        await rollbackPendingTurn(convIdForSync);
      }

      if (isConversationMissing) {
        onConversationMissing?.();
      }
      if (isUnauthorized) {
        onUnauthorized?.();
      }

      const isSensitiveRefusal = normalizedErrMsg.includes("包含敏感");
      if (isSensitiveRefusal) {
        const shouldPrefill = mode !== "regenerate";
        onSensitiveRefusal?.({ prompt, shouldPrefill });
      } else {
        onError?.(errorMessage);
      }
      streamMsgId = null;
    }
  } finally {
    if (streamMsgId !== null) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === streamMsgId ? { ...msg, isStreaming: false, isWaitingFirstChunk: false } : msg,
        ),
      );
    }
    setLoading(false);
  }
}
