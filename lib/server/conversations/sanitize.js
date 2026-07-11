import { parseWebSearchConfig } from "@/lib/server/chat/requestConfig";
import { normalizeBlobFileId } from "@/lib/shared/blobFileIds";
import {
  getModelConfig,
  normalizeModelId,
} from "@/lib/shared/models";
import { normalizeWebBrowsingIdentifier } from "@/lib/shared/webBrowsing";

const ALLOWED_UPDATE_KEYS = new Set(["title", "messages", "settings", "pinned", "model"]);

const ALLOWED_SETTINGS_KEYS = new Set(["webSearch"]);
const ALLOWED_MESSAGE_TYPES = new Set(["text", "parts", "error"]);
const ALLOWED_ROLES = new Set(["user", "model"]);
const ALLOWED_TIMELINE_KINDS = new Set(["thought", "search", "reader", "sandbox", "tool", "approval", "upload", "parse", "planner", "writer"]);
const ALLOWED_TIMELINE_STATUSES = new Set(["streaming", "running", "done", "error"]);

const MAX_MESSAGES = 500;
const MAX_MESSAGE_CHARS = 20000;
const MAX_MESSAGE_ID_CHARS = 128;
const MAX_PART_TEXT_CHARS = 10000;
const MAX_PARTS_PER_MESSAGE = 20;
const MAX_URL_CHARS = 2048;
const MAX_TITLE_CHARS = 200;
const MAX_CITATIONS = 20;
const MAX_CITATION_TITLE_CHARS = 200;
const MAX_CITATION_TEXT_CHARS = 1000;
const MAX_TIMELINE_STEPS = 50;
const MAX_TIMELINE_CONTENT_CHARS = 20000;
const MAX_TIMELINE_STRING_CHARS = 2048;
const MAX_TOOLS = 20;
const MAX_TOOL_STRING_CHARS = 8000;
const MAX_TOOL_ARGUMENT_KEYS = 20;
const MAX_TOOL_ARRAY_ITEMS = 12;
const MAX_ARTIFACTS = 20;
const MAX_FUSION_EXPERTS = 3;
const MAX_EXPERT_MODEL_CHARS = 100;
const MAX_EXPERT_LABEL_CHARS = 120;
const MAX_EXPERT_CONTENT_CHARS = 20000;
const MAX_ANALYSIS_ITEMS_PER_GROUP = 20;
const MAX_ANALYSIS_ITEM_TEXT_CHARS = 2000;
const MAX_MODEL_CHARS = 100;
const FUSION_ANALYSIS_GROUP_KEYS = ["agreement", "keyDifferences", "partialCoverage", "uniqueInsights", "blindSpots"];
const FUSION_ANALYSIS_MODELS = new Set(["GPT", "Claude", "Gemini"]);

const ALLOWED_IMAGE_DOMAINS = [
  "blob.vercel-storage.com",
  "public.blob.vercel-storage.com",
];

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isAllowedImageUrl(url) {
  if (typeof url !== "string" || !url.trim() || url.length > MAX_URL_CHARS) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const hostname = parsed.hostname.toLowerCase();
    return ALLOWED_IMAGE_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
}

function isAllowedBlobUrl(url) {
  return isAllowedImageUrl(url);
}

function sanitizeCitations(value, fieldPath) {
  if (!Array.isArray(value)) return [];
  if (value.length > MAX_CITATIONS) throw new Error(`${fieldPath} too many`);
  const citations = [];
  for (const item of value) {
    if (!isPlainObject(item)) continue;
    const url = typeof item.url === "string" ? item.url : "";
    const title = typeof item.title === "string" ? item.title : "";
    const citedText = typeof item.cited_text === "string" ? item.cited_text : "";
    if (!url || url.length > MAX_URL_CHARS) continue;
    const entry = { url, title: title.slice(0, MAX_CITATION_TITLE_CHARS) };
    if (citedText) entry.cited_text = citedText.slice(0, MAX_CITATION_TEXT_CHARS);
    citations.push(entry);
  }
  return citations;
}

function sanitizeFusionAnalysis(value, fieldPath) {
  if (!isPlainObject(value)) return null;

  const result = {};
  for (const key of FUSION_ANALYSIS_GROUP_KEYS) {
    const rawItems = Array.isArray(value[key]) ? value[key] : [];
    if (rawItems.length > MAX_ANALYSIS_ITEMS_PER_GROUP) {
      throw new Error(`${fieldPath}.${key} too many`);
    }

    const items = [];
    for (const [index, item] of rawItems.entries()) {
      if (!isPlainObject(item)) continue;
      const text = typeof item.text === "string"
        ? item.text.trim().slice(0, MAX_ANALYSIS_ITEM_TEXT_CHARS)
        : "";
      if (!text) {
        throw new Error(`${fieldPath}.${key}[${index}].text invalid`);
      }

      const models = Array.isArray(item.models)
        ? Array.from(new Set(
            item.models
              .filter((model) => typeof model === "string")
              .map((model) => model.trim())
              .filter((model) => FUSION_ANALYSIS_MODELS.has(model))
          ))
        : [];

      items.push({ text, models });
    }

    result[key] = items;
  }

  return result;
}

function sanitizeJsonValue(value, depth = 0) {
  if (depth > 4) return undefined;
  if (typeof value === "string") return value.slice(0, MAX_TOOL_STRING_CHARS);
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_TOOL_ARRAY_ITEMS)
      .map((item) => sanitizeJsonValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (!isPlainObject(value)) return undefined;

  const next = {};
  for (const [key, item] of Object.entries(value).slice(0, MAX_TOOL_ARGUMENT_KEYS)) {
    const sanitized = sanitizeJsonValue(item, depth + 1);
    if (sanitized !== undefined) next[key] = sanitized;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function sanitizeProviderState(value, depth = 0) {
  if (depth > 10) return undefined;
  if (typeof value === "string") return value.slice(0, 250000);
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 200).map((item) => sanitizeProviderState(item, depth + 1)).filter((item) => item !== undefined);
  }
  if (!isPlainObject(value)) return undefined;
  const next = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    const sanitized = sanitizeProviderState(item, depth + 1);
    if (sanitized !== undefined) next[key] = sanitized;
  }
  return Object.keys(next).length ? next : undefined;
}

function sanitizeArtifacts(value, fieldPath) {
  if (!Array.isArray(value)) return [];
  if (value.length > MAX_ARTIFACTS) throw new Error(`${fieldPath} too many`);
  const artifacts = [];
  for (const item of value) {
    if (!isPlainObject(item)) continue;
    const url = typeof item.url === "string" ? item.url.trim() : "";
    if (!url || !isAllowedBlobUrl(url)) continue;
    artifacts.push({
      url,
      title: typeof item.title === "string" ? item.title.slice(0, MAX_TITLE_CHARS) : "",
      pathname: typeof item.pathname === "string" ? item.pathname.slice(0, MAX_TIMELINE_STRING_CHARS) : "",
      mimeType: typeof item.mimeType === "string" ? item.mimeType.slice(0, 128) : "",
      extension: typeof item.extension === "string" ? item.extension.slice(0, 32) : "",
      size: Number.isFinite(item.size) ? Math.max(0, Math.floor(item.size)) : 0,
    });
  }
  return artifacts;
}

function sanitizeTools(value, fieldPath) {
  if (!Array.isArray(value)) return [];
  if (value.length > MAX_TOOLS) throw new Error(`${fieldPath} too many`);
  const tools = [];
  for (const [toolIndex, item] of value.entries()) {
    if (!isPlainObject(item)) continue;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const identifier = normalizeWebBrowsingIdentifier(
      typeof item.identifier === "string" ? item.identifier.trim() : ""
    );
    const apiName = typeof item.apiName === "string" ? item.apiName.trim() : "";
    if (!id || id.length > MAX_MESSAGE_ID_CHARS) {
      throw new Error(`${fieldPath}[${toolIndex}].id invalid`);
    }
    if (!identifier || identifier.length > MAX_MODEL_CHARS) {
      throw new Error(`${fieldPath}[${toolIndex}].identifier invalid`);
    }
    if (!apiName || apiName.length > MAX_MODEL_CHARS) {
      throw new Error(`${fieldPath}[${toolIndex}].apiName invalid`);
    }
    const tool = {
      id,
      identifier,
      apiName,
      type: typeof item.type === "string" ? item.type.slice(0, 32) : "builtin",
      status: typeof item.status === "string" ? item.status.slice(0, 32) : "success",
    };
    if (typeof item.title === "string" && item.title) tool.title = item.title.slice(0, MAX_TITLE_CHARS);
    if (typeof item.summary === "string" && item.summary) tool.summary = item.summary.slice(0, MAX_TOOL_STRING_CHARS);
    if (typeof item.content === "string" && item.content) tool.content = item.content.slice(0, MAX_TOOL_STRING_CHARS);
    if (typeof item.startedAt === "string" && item.startedAt) tool.startedAt = item.startedAt;
    if (typeof item.finishedAt === "string" && item.finishedAt) tool.finishedAt = item.finishedAt;

    const args = sanitizeJsonValue(item.arguments);
    if (args !== undefined) tool.arguments = args;
    const state = sanitizeJsonValue(item.state);
    if (state !== undefined) tool.state = state;

    const citations = sanitizeCitations(item.citations, `${fieldPath}[${toolIndex}].citations`);
    if (citations.length > 0) tool.citations = citations;

    const artifacts = sanitizeArtifacts(item.artifacts, `${fieldPath}[${toolIndex}].artifacts`);
    if (artifacts.length > 0) tool.artifacts = artifacts;

    tools.push(tool);
  }
  return tools;
}

export function sanitizeMessage(message, index, { allowContentFallback = false } = {}) {
  if (!isPlainObject(message)) throw new Error(`messages[${index}] must be an object`);

  const role = message.role;
  const type = typeof message.type === "string" ? message.type : (allowContentFallback ? "text" : "");
  if (!ALLOWED_ROLES.has(role)) throw new Error(`messages[${index}].role invalid`);
  if (!ALLOWED_MESSAGE_TYPES.has(type)) throw new Error(`messages[${index}].type invalid`);

  const content = typeof message.content === "string" ? message.content : "";
  if (content.length > MAX_MESSAGE_CHARS) throw new Error(`messages[${index}].content too long`);

  const out = { role, type, content };

  if (typeof message.id === "string") {
    if (!message.id || message.id.length > MAX_MESSAGE_ID_CHARS) {
      throw new Error(`messages[${index}].id invalid`);
    }
    out.id = message.id;
  }

  if (typeof message.thought === "string") {
    if (message.thought.length > MAX_MESSAGE_CHARS) throw new Error(`messages[${index}].thought too long`);
    if (message.thought) out.thought = message.thought;
  }

  const citations = sanitizeCitations(message.citations, `messages[${index}].citations`);
  if (citations.length > 0) out.citations = citations;

  const tools = sanitizeTools(message.tools, `messages[${index}].tools`);
  if (tools.length > 0) out.tools = tools;

  const artifacts = sanitizeArtifacts(message.artifacts, `messages[${index}].artifacts`);
  if (artifacts.length > 0) out.artifacts = artifacts;

  const providerState = sanitizeProviderState(message.providerState);
  if (providerState !== undefined) out.providerState = providerState;

  if (Number.isFinite(message.searchContextTokens) && message.searchContextTokens > 0) {
    out.searchContextTokens = Math.max(0, Math.floor(message.searchContextTokens));
  }

  if (Array.isArray(message.thinkingTimeline) && message.thinkingTimeline.length > 0) {
    if (message.thinkingTimeline.length > MAX_TIMELINE_STEPS) {
      throw new Error(`messages[${index}].thinkingTimeline too many`);
    }
    const timeline = [];
    for (const step of message.thinkingTimeline) {
      if (!isPlainObject(step)) continue;
      const kind = typeof step.kind === "string" ? step.kind : "";
      if (!ALLOWED_TIMELINE_KINDS.has(kind)) continue;
      let status = typeof step.status === "string" ? step.status : "done";
      if (!ALLOWED_TIMELINE_STATUSES.has(status)) status = "done";
      if (status === "streaming" || status === "running") status = "done";
      const entry = { kind, status };
      if (typeof step.id === "string" && step.id.length <= MAX_MESSAGE_ID_CHARS) entry.id = step.id;
      if (typeof step.content === "string") entry.content = step.content.slice(0, MAX_TIMELINE_CONTENT_CHARS);
      if (typeof step.query === "string") entry.query = step.query.slice(0, MAX_TIMELINE_STRING_CHARS);
      if (typeof step.title === "string") entry.title = step.title.slice(0, MAX_TIMELINE_STRING_CHARS);
      if (typeof step.url === "string") entry.url = step.url.slice(0, MAX_URL_CHARS);
      if (typeof step.message === "string") entry.message = step.message.slice(0, MAX_TIMELINE_STRING_CHARS);
      if (Number.isFinite(step.round)) entry.round = step.round;
      if (Number.isFinite(step.resultCount)) entry.resultCount = step.resultCount;
      if (step.synthetic === true) entry.synthetic = true;
      timeline.push(entry);
    }
    if (timeline.length > 0) out.thinkingTimeline = timeline;
  }

  const sourceParts = Array.isArray(message.parts) && message.parts.length > 0
    ? message.parts
    : (allowContentFallback && content ? [{ text: content }] : []);

  if (!allowContentFallback && sourceParts.length === 0) {
    throw new Error(`messages[${index}].parts required`);
  }
  if (sourceParts.length > MAX_PARTS_PER_MESSAGE) {
    throw new Error(`messages[${index}].parts too many`);
  }

  const parts = [];
  for (const part of sourceParts) {
    if (!isPlainObject(part)) continue;
    const nextPart = {};
    if (typeof part.text === "string") {
      if (part.text.length > MAX_PART_TEXT_CHARS) {
        throw new Error(`messages[${index}].parts text too long`);
      }
      if (part.text) nextPart.text = part.text;
    }
    if (part.thought === true) nextPart.thought = true;
    if (isPlainObject(part.inlineData)) {
      const url = part.inlineData.url;
      if (!isAllowedImageUrl(url)) throw new Error(`messages[${index}].parts image invalid`);
      const mimeType = typeof part.inlineData.mimeType === "string" ? part.inlineData.mimeType.trim() : "";
      if (!mimeType || mimeType.length > 128) {
        throw new Error(`messages[${index}].parts image mimeType invalid`);
      }
      nextPart.inlineData = { url, mimeType };
      const blobFileId = normalizeBlobFileId(part.inlineData.blobFileId);
      if (blobFileId) nextPart.inlineData.blobFileId = blobFileId;
    }
    if (isPlainObject(part.fileData)) {
      const url = typeof part.fileData.url === "string" ? part.fileData.url.trim() : "";
      const name = typeof part.fileData.name === "string" ? part.fileData.name.trim() : "";
      const mimeType = typeof part.fileData.mimeType === "string" ? part.fileData.mimeType.trim() : "";
      const extension = typeof part.fileData.extension === "string" ? part.fileData.extension.trim().toLowerCase() : "";
      const category = typeof part.fileData.category === "string" ? part.fileData.category.trim() : "";
      const size = Number(part.fileData.size);
      if (!url || !isAllowedBlobUrl(url)) {
        throw new Error(`messages[${index}].parts file invalid`);
      }
      if (!name || name.length > MAX_TITLE_CHARS) {
        throw new Error(`messages[${index}].parts file name invalid`);
      }
      if (!mimeType || mimeType.length > 128) {
        throw new Error(`messages[${index}].parts file mimeType invalid`);
      }
      if (!extension || extension.length > 32) {
        throw new Error(`messages[${index}].parts file extension invalid`);
      }
      if (!category || category.length > 32) {
        throw new Error(`messages[${index}].parts file category invalid`);
      }
      if (!Number.isFinite(size) || size < 0) {
        throw new Error(`messages[${index}].parts file size invalid`);
      }
      nextPart.fileData = { url, name, mimeType, size, extension, category };
      const blobFileId = normalizeBlobFileId(part.fileData.blobFileId);
      if (blobFileId) nextPart.fileData.blobFileId = blobFileId;
    }
    if (typeof part.thoughtSignature === "string" && part.thoughtSignature.length <= 256) {
      nextPart.thoughtSignature = part.thoughtSignature;
    }
    if (Object.keys(nextPart).length > 0) parts.push(nextPart);
  }

  if (parts.length === 0) {
    throw new Error(`messages[${index}].parts invalid`);
  }
  out.parts = parts;

  if (Array.isArray(message.fusionExperts)) {
    if (message.fusionExperts.length > MAX_FUSION_EXPERTS) {
      throw new Error(`messages[${index}].fusionExperts too many`);
    }
    const experts = [];
    for (const [expertIndex, expert] of message.fusionExperts.entries()) {
      if (!isPlainObject(expert)) continue;
      const modelId = typeof expert.modelId === "string" ? expert.modelId.trim() : "";
      const label = typeof expert.label === "string" ? expert.label.trim() : "";
      const contentText = typeof expert.content === "string" ? expert.content : "";
      if (!modelId || modelId.length > MAX_EXPERT_MODEL_CHARS) {
        throw new Error(`messages[${index}].fusionExperts[${expertIndex}].modelId invalid`);
      }
      if (!label || label.length > MAX_EXPERT_LABEL_CHARS) {
        throw new Error(`messages[${index}].fusionExperts[${expertIndex}].label invalid`);
      }
      if (!contentText || contentText.length > MAX_EXPERT_CONTENT_CHARS) {
        throw new Error(`messages[${index}].fusionExperts[${expertIndex}].content invalid`);
      }
      const expertEntry = { modelId, label, content: contentText };
      if (Number.isFinite(expert.durationMs) && expert.durationMs >= 0) {
        expertEntry.durationMs = Math.max(0, Math.floor(expert.durationMs));
      }
      const expertCitations = sanitizeCitations(
        expert.citations,
        `messages[${index}].fusionExperts[${expertIndex}].citations`
      );
      if (expertCitations.length > 0) expertEntry.citations = expertCitations;
      experts.push(expertEntry);
    }
    if (experts.length > 0) out.fusionExperts = experts;
  }

  const fusionAnalysis = sanitizeFusionAnalysis(message.fusionAnalysis, `messages[${index}].fusionAnalysis`);
  if (fusionAnalysis) out.fusionAnalysis = fusionAnalysis;

  if (message.createdAt) {
    const date = new Date(message.createdAt);
    if (!Number.isNaN(date.getTime())) out.createdAt = date;
  }

  return out;
}

export function sanitizeMessages(messages, options) {
  if (!Array.isArray(messages)) return [];
  if (messages.length > MAX_MESSAGES) throw new Error(`messages too many (max ${MAX_MESSAGES})`);
  return messages.map((message, index) => sanitizeMessage(message, index, options));
}

export function sanitizeConversationSettingsUpdates(settings) {
  const updates = {};
  for (const [settingKey, settingValue] of Object.entries(settings || {})) {
    if (!ALLOWED_SETTINGS_KEYS.has(settingKey)) continue;
    if (settingKey === "webSearch") {
      updates[`settings.${settingKey}`] = parseWebSearchConfig(settingValue);
    }
  }
  return updates;
}

export function sanitizeConversationBody(body) {
  if (!isPlainObject(body)) {
    throw new Error("Invalid request body");
  }

  for (const key of Object.keys(body)) {
    if (!ALLOWED_UPDATE_KEYS.has(key)) {
      throw new Error("Unsupported field in request body");
    }
  }

  if (body.messages !== undefined && !Array.isArray(body.messages)) {
    throw new Error("messages must be an array");
  }

  if (body.pinned !== undefined && typeof body.pinned !== "boolean") {
    throw new Error("pinned must be a boolean");
  }

  if (body.settings !== undefined && !isPlainObject(body.settings)) {
    throw new Error("settings must be an object");
  }

  const update = {};
  let shouldTouchUpdatedAt = false;

  if (typeof body.title === "string") {
    if (body.title.length > MAX_TITLE_CHARS) {
      throw new Error("title too long");
    }
    update.title = body.title;
  }

  if (body.model !== undefined) {
    if (typeof body.model !== "string" || !body.model.trim()) {
      throw new Error("model invalid");
    }
    const normalizedModel = normalizeModelId(body.model.trim());
    if (!getModelConfig(normalizedModel)) {
      throw new Error("model invalid");
    }
    update.model = normalizedModel;
  }

  if (Array.isArray(body.messages)) {
    update.messages = sanitizeMessages(body.messages);
    shouldTouchUpdatedAt = true;
  }

  if (typeof body.pinned === "boolean") {
    update.pinned = body.pinned;
  }

  if (body.settings) {
    Object.assign(update, sanitizeConversationSettingsUpdates(body.settings));
  }

  if (shouldTouchUpdatedAt) {
    update.updatedAt = Date.now();
  }

  return update;
}

export function sanitizeImportedConversationSettings(settings, index) {
  if (!isPlainObject(settings)) return undefined;

  const out = {};
  for (const [settingKey, settingValue] of Object.entries(settings)) {
    if (!ALLOWED_SETTINGS_KEYS.has(settingKey)) continue;
    if (settingKey === "webSearch") {
      try {
        out.webSearch = parseWebSearchConfig(settingValue);
      } catch {
        throw new Error(`conversations[${index}].settings.webSearch invalid`);
      }
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

export function sanitizeImportedConversation(conversation, index, userId) {
  if (!isPlainObject(conversation)) throw new Error(`conversations[${index}] must be an object`);

  const title = typeof conversation.title === "string" ? conversation.title : "New Chat";
  if (title.length > MAX_TITLE_CHARS) {
    throw new Error(`conversations[${index}].title too long`);
  }

  const messagesSrc = Array.isArray(conversation.messages) ? conversation.messages : [];
  const pinned = typeof conversation.pinned === "boolean" ? conversation.pinned : false;
  const messages = sanitizeMessages(messagesSrc, { allowContentFallback: true });

  const out = {
    userId,
    title,
    messages,
    pinned,
  };

  if (typeof conversation.model === "string" && conversation.model.trim()) {
    const model = normalizeModelId(conversation.model.trim());
    if (model.length > MAX_MODEL_CHARS) {
      throw new Error(`conversations[${index}].model too long`);
    }
    if (!getModelConfig(model)) {
      throw new Error(`conversations[${index}].model invalid`);
    }
    out.model = model;
  }

  const settings = sanitizeImportedConversationSettings(conversation.settings, index);
  if (settings) out.settings = settings;

  if (conversation.updatedAt) {
    const date = new Date(conversation.updatedAt);
    if (!Number.isNaN(date.getTime())) out.updatedAt = date;
  }

  return out;
}
