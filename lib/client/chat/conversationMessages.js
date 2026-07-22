import { normalizeWebBrowsingIdentifier } from "@/lib/shared/webBrowsing";

const PENDING_MESSAGE_TEXTS = new Set(["正在处理中…", "Fusion 正在处理中…"]);

export function hasDisplayableModelProgress(message) {
  if (!message || message.role !== "model") return false;

  const content = typeof message.content === "string" ? message.content.trim() : "";
  if (content && !PENDING_MESSAGE_TEXTS.has(content)) {
    return true;
  }

  if (typeof message.thought === "string" && message.thought.trim()) {
    return true;
  }

  if (typeof message.searchError === "string" && message.searchError.trim()) {
    return true;
  }

  if (Array.isArray(message.parts) && message.parts.some((part) => {
    const text = typeof part?.text === "string" ? part.text.trim() : "";
    return text && !PENDING_MESSAGE_TEXTS.has(text);
  })) {
    return true;
  }

  if (Array.isArray(message.thinkingTimeline) && message.thinkingTimeline.length > 0) {
    return true;
  }

  if (message.fusionAnalysis && typeof message.fusionAnalysis === "object") {
    return true;
  }

  if (message.fusionResultState && typeof message.fusionResultState === "object") {
    return true;
  }

  return false;
}

export function decorateConversationMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map((message) => ({
    ...message,
    tools: Array.isArray(message?.tools)
      ? message.tools.map((tool) => (
        tool && typeof tool === "object"
          ? { ...tool, identifier: normalizeWebBrowsingIdentifier(tool.identifier) || tool.identifier }
          : tool
      ))
      : message?.tools,
    isStreaming: false,
    isWaitingFirstChunk: false,
    isThinkingStreaming: false,
  }));
}

export function mergeConversationMessages(serverMessages, localMessages) {
  const nextServerMessages = decorateConversationMessages(serverMessages);
  if (!Array.isArray(localMessages) || localMessages.length === 0) {
    return nextServerMessages;
  }

  const localById = new Map(
    localMessages
      .filter((message) => typeof message?.id === "string" && message.id)
      .map((message) => [message.id, message]),
  );

  const serverIds = new Set(
    nextServerMessages
      .filter((message) => typeof message?.id === "string" && message.id)
      .map((message) => message.id),
  );

  const merged = nextServerMessages.map((serverMessage) => {
    const localMessage = localById.get(serverMessage?.id);
    if (!localMessage) return serverMessage;

    const nextMessage = { ...serverMessage };
    const serverContent = typeof serverMessage?.content === "string" ? serverMessage.content : "";
    const localContent = typeof localMessage?.content === "string" ? localMessage.content : "";

    if (localContent.length > serverContent.length) {
      nextMessage.content = localContent;
      if (Array.isArray(localMessage?.parts) && localMessage.parts.length > 0) {
        nextMessage.parts = localMessage.parts;
      }
    }

    const serverThought = typeof serverMessage?.thought === "string" ? serverMessage.thought : "";
    const localThought = typeof localMessage?.thought === "string" ? localMessage.thought : "";
    if (localThought.length > serverThought.length) {
      nextMessage.thought = localThought;
    }

    if (
      Array.isArray(localMessage?.thinkingTimeline)
      && localMessage.thinkingTimeline.length > (Array.isArray(serverMessage?.thinkingTimeline) ? serverMessage.thinkingTimeline.length : 0)
    ) {
      nextMessage.thinkingTimeline = localMessage.thinkingTimeline;
    }

    if (
      Array.isArray(localMessage?.fusionExperts)
      && localMessage.fusionExperts.length > (Array.isArray(serverMessage?.fusionExperts) ? serverMessage.fusionExperts.length : 0)
    ) {
      nextMessage.fusionExperts = localMessage.fusionExperts;
    }

    if (
      Array.isArray(localMessage?.citations)
      && localMessage.citations.length > (Array.isArray(serverMessage?.citations) ? serverMessage.citations.length : 0)
    ) {
      nextMessage.citations = localMessage.citations;
    }

    if (!nextMessage.searchError && localMessage?.searchError) {
      nextMessage.searchError = localMessage.searchError;
    }

    if (!nextMessage.searchQuery && localMessage?.searchQuery) {
      nextMessage.searchQuery = localMessage.searchQuery;
    }

    if (!nextMessage.searchResults && localMessage?.searchResults) {
      nextMessage.searchResults = localMessage.searchResults;
    }

    if (!nextMessage.fusionAnalysis && localMessage?.fusionAnalysis) {
      nextMessage.fusionAnalysis = localMessage.fusionAnalysis;
    }

    if (!nextMessage.fusionResultState && localMessage?.fusionResultState) {
      nextMessage.fusionResultState = localMessage.fusionResultState;
    }

    if (serverMessage?.isStreaming) {
      nextMessage.isStreaming = true;
      nextMessage.isWaitingFirstChunk = Boolean(serverMessage?.isWaitingFirstChunk)
        || (Boolean(localMessage?.isWaitingFirstChunk) && !hasDisplayableModelProgress(serverMessage));
      nextMessage.isThinkingStreaming = Boolean(serverMessage?.isThinkingStreaming)
        || Boolean(localMessage?.isThinkingStreaming);
    }

    return nextMessage;
  });

  const trailingLocalMessages = [];
  for (let i = localMessages.length - 1; i >= 0; i -= 1) {
    const message = localMessages[i];
    const messageId = typeof message?.id === "string" ? message.id : "";
    if (messageId && serverIds.has(messageId)) {
      break;
    }
    trailingLocalMessages.unshift(message);
  }

  if (trailingLocalMessages.length === 0) {
    return merged;
  }

  return [...merged, ...trailingLocalMessages];
}
