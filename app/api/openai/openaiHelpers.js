import {
  fetchImageAsBase64,
  isNonEmptyString,
  getStoredPartsFromMessage,
} from "@/app/api/chat/utils";
import { buildAttachmentTextBlock } from "@/lib/server/files/service";

function sanitizeJsonValue(value, depth = 0) {
  if (depth > 6) return undefined;
  if (typeof value === "string") return value.slice(0, 12000);
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map((item) => sanitizeJsonValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (!value || typeof value !== "object") return undefined;
  const next = {};
  for (const [key, item] of Object.entries(value).slice(0, 80)) {
    const sanitized = sanitizeJsonValue(item, depth + 1);
    if (sanitized !== undefined) next[key] = sanitized;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeChunkText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item.text === "string") return item.text;
      if (item && typeof item.content === "string") return item.content;
      return "";
    }).join("");
  }
  if (value && typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (typeof value.content === "string") return value.content;
  }
  return "";
}

export function normalizeOpenAIOutputItems(output) {
  if (!Array.isArray(output)) return [];
  return output
    .map((item) => sanitizeJsonValue(item))
    .filter((item) => item && typeof item === "object");
}

export function extractOpenAIResponseText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const outputs = Array.isArray(payload?.output) ? payload.output : [];

  // Try to extract text from Responses API output_text items.
  const outputTextItems = outputs.filter((item) => item?.type === "output_text" || item?.type === "text");
  if (outputTextItems.length > 0) {
    return outputTextItems
      .map((item) => normalizeChunkText(item?.text ?? item))
      .join("")
      .trim();
  }

  // Fallback: try to get text directly from payload
  if (typeof payload?.text === "string" && payload.text.trim()) {
    return payload.text.trim();
  }

  return outputs
    .filter((item) => item?.type === "message")
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .map((item) => normalizeChunkText(item?.text ?? item))
    .join("")
    .trim();
}

export function extractOpenAIResponseReasoning(payload) {
  const outputs = Array.isArray(payload?.output) ? payload.output : [];

  // 从完整响应的 output 数组中提取 reasoning 项（response.completed 格式）
  const fromOutput = outputs
    .filter((item) => item?.type === "reasoning")
    .flatMap((item) => {
      const summary = Array.isArray(item?.summary) ? item.summary : [];
      if (summary.length > 0) return summary;
      const content = Array.isArray(item?.content) ? item.content : [];
      return content;
    })
    .map((item) => normalizeChunkText(item?.text ?? item))
    .join("")
    .trim();

  if (fromOutput) return fromOutput;

  // 从流式累积结果的独立 reasoning 数组中提取（accumulated 格式）
  const reasoningItems = Array.isArray(payload?.reasoning) ? payload.reasoning : [];
  return reasoningItems
    .map((item) => normalizeChunkText(item?.text ?? item))
    .join("")
    .trim();
}

export function extractOpenAIFunctionCalls(payload) {
  const outputs = Array.isArray(payload?.output) ? payload.output : [];
  return outputs
    .filter((item) => item?.type === "function_call" && typeof item?.name === "string" && item.name && typeof item?.call_id === "string" && item.call_id)
    .map((item) => ({
      id: typeof item?.id === "string" ? item.id : "",
      call_id: item.call_id,
      name: item.name,
      arguments: typeof item?.arguments === "string" ? item.arguments : JSON.stringify(item?.arguments || {}),
    }));
}

export async function storedPartToOpenAIPart(part, role, options = {}) {
  if (!part || typeof part !== "object") return null;

  // assistant 角色使用 output_text，user 角色使用 input_text
  const isAssistant = role === "assistant" || role === "model";

  if (isNonEmptyString(part.text)) {
    return isAssistant
      ? { type: "output_text", text: part.text }
      : { type: "input_text", text: part.text };
  }

  const fileUrl = part?.fileData?.url;
  if (isNonEmptyString(fileUrl)) {
    const fileTextMap = options?.fileTextMap instanceof Map ? options.fileTextMap : new Map();
    const prepared = fileTextMap.get(fileUrl);
    const extractedText = prepared?.structuredText || prepared?.extractedText || "";
    if (isNonEmptyString(extractedText)) {
      const block = buildAttachmentTextBlock(prepared.file || part.fileData, extractedText);
      return isAssistant
        ? { type: "output_text", text: block }
        : { type: "input_text", text: block };
    }
  }

  // 图片只对 user 角色有效
  if (!isAssistant) {
    const url = part?.inlineData?.url;
    if (isNonEmptyString(url)) {
      const { base64Data, mimeType: fetchedMimeType } =
        await fetchImageAsBase64(url);
      const mimeType = part.inlineData?.mimeType;
      return {
        type: "input_image",
        image_url: `data:${mimeType};base64,${base64Data}`,
      };
    }
  }

  return null;
}

export async function buildResponsesInputFromHistory(messages, options = {}) {
  const providerStateKey = typeof options?.providerStateKey === "string" && options.providerStateKey.trim()
    ? options.providerStateKey.trim()
    : "openai";
  const input = [];
  for (const msg of messages) {
    if (msg?.role !== "user" && msg?.role !== "model") continue;

    if (msg.role === "model") {
      const providerOutput = Array.isArray(msg?.providerState?.[providerStateKey]?.output)
        ? msg.providerState[providerStateKey].output
        : [];
      if (providerOutput.length > 0) {
        input.push(...providerOutput);
        continue;
      }
    }

    const storedParts = getStoredPartsFromMessage(msg);
    if (!storedParts || storedParts.length === 0) continue;

    const openaiRole = msg.role === "model" ? "assistant" : "user";
    const content = [];
    for (const storedPart of storedParts) {
      const p = await storedPartToOpenAIPart(storedPart, openaiRole, options);
      if (p) content.push(p);
    }
    if (content.length) {
      input.push({ role: openaiRole, content });
    }
  }
  return input;
}

export async function buildOpenAIInputFromHistory(messages, options = {}) {
  return buildResponsesInputFromHistory(messages, {
    ...options,
    providerStateKey: "openai",
  });
}
