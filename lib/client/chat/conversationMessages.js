import { normalizeWebBrowsingIdentifier } from "@/lib/shared/webBrowsing";

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
    isStreaming: message?.role === "model" && ["queued", "running", "waiting_media", "waiting_approval"].includes(message?.taskStatus),
    isWaitingFirstChunk: false,
    isThinkingStreaming: false,
  }));
}
