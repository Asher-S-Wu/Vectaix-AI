import {
  getStoredPartsFromMessage,
  isNonEmptyString,
} from "@/app/api/chat/utils";
import {
  buildPrivateImageDataUrl,
  loadOwnedMedia,
} from "@/lib/server/storage/providerMedia";

async function storedPartToProviderContent(part, role, { userId } = {}) {
  if (!part || typeof part !== "object") return null;
  if (isNonEmptyString(part.text)) return { type: "text", text: part.text };
  if (role === "assistant") return null;

  if (part?.inlineData?.fileId) {
    const image = await buildPrivateImageDataUrl({ userId, fileId: part.inlineData.fileId });
    return {
      type: "image_url",
      image_url: { url: image.dataUrl },
    };
  }

  if (part?.fileData?.fileId) {
    const file = await loadOwnedMedia({
      userId,
      fileId: part.fileData.fileId,
      categories: ["audio", "video"],
    });
    return {
      type: "private_media",
      media: { category: file.category, file },
    };
  }
  return null;
}

function normalizeProviderContent(contentParts) {
  return Array.isArray(contentParts) && contentParts.length > 0 ? contentParts : "";
}

export async function buildChatMessagesFromHistory(messages, options = {}) {
  const result = [];
  for (const msg of messages) {
    if (msg?.role !== "user" && msg?.role !== "model") continue;
    const role = msg.role === "model" ? "assistant" : "user";
    if (role === "assistant" && isNonEmptyString(msg?.content)) {
      result.push({
        role,
        content: msg.content,
        ...(msg?.providerState ? { providerState: msg.providerState } : {}),
      });
      continue;
    }
    const storedParts = getStoredPartsFromMessage(msg);
    if (!storedParts?.length) continue;
    const contentParts = [];
    for (const part of storedParts) {
      const resolved = await storedPartToProviderContent(part, role, options);
      if (resolved) contentParts.push(resolved);
    }
    if (contentParts.length > 0) {
      result.push({
        role,
        content: normalizeProviderContent(contentParts),
        ...(msg?.providerState ? { providerState: msg.providerState } : {}),
      });
    }
  }
  return result;
}

export async function buildCurrentUserMessage({ prompt, images, attachments, userId }) {
  const content = [];
  if (isNonEmptyString(prompt)) content.push({ type: "text", text: prompt });
  for (const image of Array.isArray(images) ? images : []) {
    if (!image?.fileId) continue;
    const resolved = await buildPrivateImageDataUrl({ userId, fileId: image.fileId });
    content.push({ type: "image_url", image_url: { url: resolved.dataUrl } });
  }
  for (const attachment of Array.isArray(attachments) ? attachments : []) {
    if (!attachment?.fileId) continue;
    const file = await loadOwnedMedia({
      userId,
      fileId: attachment.fileId,
      categories: ["audio", "video"],
    });
    content.push({ type: "private_media", media: { category: file.category, file } });
  }
  return content;
}

export function normalizeOpenAIMessageContentParts(contentParts) {
  return normalizeProviderContent(contentParts);
}
