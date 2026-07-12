import { normalizeFileId } from "@/lib/shared/fileIds";
import { normalizeWebBrowsingIdentifier } from "@/lib/shared/webBrowsing";

const ALLOWED_PERSISTED_TYPES = new Set(["text", "parts", "error"]);
const ALLOWED_PERSISTED_ROLES = new Set(["user", "model"]);
const ALLOWED_TIMELINE_KINDS = new Set(["thought", "search", "reader", "tool", "approval", "planner", "writer"]);
const ALLOWED_TIMELINE_STATUSES = new Set(["streaming", "running", "done", "error"]);
const PENDING_MESSAGE_TEXTS = new Set(["正在处理中...", "Fusion 正在处理中..."]);
const FUSION_ANALYSIS_GROUP_KEYS = ["agreement", "keyDifferences", "partialCoverage", "uniqueInsights", "blindSpots"];
const FUSION_MODELS = new Set(["GPT", "Claude", "Gemini"]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizePersistedCitations(citations) {
  if (!Array.isArray(citations)) return undefined;
  const next = citations
    .filter((item) => item && typeof item === "object" && isNonEmptyString(item.url))
    .map((item) => {
      const entry = {
        url: item.url,
        title: typeof item.title === "string" ? item.title : "",
      };
      if (typeof item.cited_text === "string" && item.cited_text) {
        entry.cited_text = item.cited_text;
      }
      return entry;
    });
  return next.length > 0 ? next : undefined;
}

function sanitizeJsonValue(value, depth = 0) {
  if (depth > 4) return undefined;
  if (typeof value === "string") return value.slice(0, 8000);
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, 12)
      .map((item) => sanitizeJsonValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (!value || typeof value !== "object") return undefined;
  const next = {};
  for (const [key, item] of Object.entries(value).slice(0, 20)) {
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
  if (!value || typeof value !== "object") return undefined;
  const next = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    const sanitized = sanitizeProviderState(item, depth + 1);
    if (sanitized !== undefined) next[key] = sanitized;
  }
  return Object.keys(next).length ? next : undefined;
}

function normalizePersistedProviderState(providerState) {
  if (!providerState || typeof providerState !== "object" || Array.isArray(providerState)) return undefined;
  return sanitizeProviderState(providerState);
}

function normalizePersistedTools(tools) {
  if (!Array.isArray(tools)) return undefined;
  const next = tools
    .filter((item) => item && typeof item === "object" && isNonEmptyString(item.id) && isNonEmptyString(item.identifier) && isNonEmptyString(item.apiName))
    .map((item) => {
      const identifier = normalizeWebBrowsingIdentifier(item.identifier) || item.identifier;
      const entry = {
        id: item.id,
        identifier,
        apiName: item.apiName,
        type: typeof item.type === "string" ? item.type : "builtin",
        status: typeof item.status === "string" ? item.status : "success",
      };
      if (typeof item.title === "string" && item.title) entry.title = item.title;
      if (typeof item.summary === "string" && item.summary) entry.summary = item.summary;
      if (typeof item.content === "string" && item.content) entry.content = item.content;
      if (typeof item.startedAt === "string" && item.startedAt) entry.startedAt = item.startedAt;
      if (typeof item.finishedAt === "string" && item.finishedAt) entry.finishedAt = item.finishedAt;
      const args = sanitizeJsonValue(item.arguments);
      if (args !== undefined) entry.arguments = args;
      const state = sanitizeJsonValue(item.state);
      if (state !== undefined) entry.state = state;
      const citations = normalizePersistedCitations(item.citations);
      if (citations) entry.citations = citations;
      return entry;
    });
  return next.length > 0 ? next : undefined;
}

function normalizePersistedTimeline(steps) {
  if (!Array.isArray(steps)) return undefined;
  const next = steps
    .filter((step) => step && typeof step === "object" && ALLOWED_TIMELINE_KINDS.has(step.kind))
    .map((step) => {
      let status = typeof step.status === "string" && ALLOWED_TIMELINE_STATUSES.has(step.status)
        ? step.status
        : "done";
      if (status === "streaming" || status === "running") {
        status = "done";
      }

      const entry = { kind: step.kind, status };
      if (isNonEmptyString(step.id)) entry.id = step.id;
      if (typeof step.content === "string") entry.content = step.content;
      if (typeof step.query === "string") entry.query = step.query;
      if (typeof step.title === "string") entry.title = step.title;
      if (typeof step.url === "string") entry.url = step.url;
      if (typeof step.message === "string") entry.message = step.message;
      if (Number.isFinite(step.round)) entry.round = step.round;
      if (Number.isFinite(step.resultCount)) entry.resultCount = step.resultCount;
      if (step.synthetic === true) entry.synthetic = true;
      return entry;
    });
  return next.length > 0 ? next : undefined;
}

function normalizePersistedParts(parts, content) {
  if (Array.isArray(parts) && parts.length > 0) {
    const next = parts
      .filter((part) => part && typeof part === "object")
      .map((part) => {
        const entry = {};

        if (typeof part.text === "string" && part.text) {
          entry.text = part.text;
        }
        if (part.thought === true) {
          entry.thought = true;
        }
        if (typeof part.thoughtSignature === "string" && part.thoughtSignature) {
          entry.thoughtSignature = part.thoughtSignature;
        }

        if (part.inlineData && typeof part.inlineData === "object") {
          const fileId = normalizeFileId(part.inlineData.fileId);
          if (!fileId || !isNonEmptyString(part.inlineData.url)) return Object.keys(entry).length > 0 ? entry : null;
          entry.inlineData = {
            fileId,
            url: part.inlineData.url,
            mimeType: isNonEmptyString(part.inlineData.mimeType) ? part.inlineData.mimeType : "image/jpeg",
          };
        }

        if (part.fileData && typeof part.fileData === "object") {
          const { url, name, mimeType, extension, category } = part.fileData;
          const fileId = normalizeFileId(part.fileData.fileId);
          const size = Number(part.fileData.size);
          if (
            fileId
            && isNonEmptyString(url)
            && isNonEmptyString(name)
            && isNonEmptyString(mimeType)
            && isNonEmptyString(extension)
            && isNonEmptyString(category)
            && Number.isFinite(size)
            && size >= 0
          ) {
            entry.fileData = {
              fileId,
              url,
              name,
              mimeType,
              size,
              extension,
              category,
            };
          }
        }

        return Object.keys(entry).length > 0 ? entry : null;
      })
      .filter(Boolean);

    if (next.length > 0) {
      return next;
    }
  }

  if (typeof content === "string" && content) {
    return [{ text: content }];
  }

  return undefined;
}

export function mergeLocalImagePreviews(serverMessage, localMessage) {
  if (!serverMessage || !localMessage) return serverMessage;
  if (!Array.isArray(serverMessage.parts) || !Array.isArray(localMessage.parts)) return serverMessage;

  const localImageParts = localMessage.parts.filter((part) => (
    typeof part?.inlineData?.url === "string"
    && typeof part?.inlineData?.localPreviewUrl === "string"
    && part.inlineData.localPreviewUrl
  ));
  if (localImageParts.length === 0) return serverMessage;

  let imageIndex = 0;
  let changed = false;
  const nextParts = serverMessage.parts.map((part) => {
    if (typeof part?.inlineData?.url !== "string") return part;

    const matchedByUrl = localImageParts.find((localPart) => localPart.inlineData.url === part.inlineData.url);
    const localPart = matchedByUrl || localImageParts[imageIndex];
    imageIndex += 1;

    const localPreviewUrl = typeof localPart?.inlineData?.localPreviewUrl === "string"
      ? localPart.inlineData.localPreviewUrl
      : "";
    if (!localPreviewUrl || localPreviewUrl === part.inlineData.url) return part;

    changed = true;
    return {
      ...part,
      inlineData: {
        ...part.inlineData,
        localPreviewUrl,
      },
    };
  });

  return changed ? { ...serverMessage, parts: nextParts } : serverMessage;
}

export function stripLocalImagePreviews(parts) {
  if (!Array.isArray(parts)) return parts;

  let changed = false;
  const nextParts = parts.map((part) => {
    if (!part?.inlineData || typeof part.inlineData !== "object" || part.inlineData.localPreviewUrl === undefined) {
      return part;
    }

    const inlineData = { ...part.inlineData };
    delete inlineData.localPreviewUrl;
    changed = true;
    return {
      ...part,
      inlineData,
    };
  });

  return changed ? nextParts : parts;
}

function normalizePersistedFusionExperts(experts) {
  if (!Array.isArray(experts)) return undefined;
  const next = experts
    .filter((expert) => expert && typeof expert === "object")
    .map((expert) => {
      if (!isNonEmptyString(expert.modelId) || !isNonEmptyString(expert.label) || !isNonEmptyString(expert.content)) {
        return null;
      }
      const entry = {
        modelId: expert.modelId,
        label: expert.label,
        content: expert.content,
      };
      if (Number.isFinite(expert.durationMs) && expert.durationMs >= 0) {
        entry.durationMs = Math.max(0, Math.floor(expert.durationMs));
      }
      const citations = normalizePersistedCitations(expert.citations);
      if (citations) entry.citations = citations;
      return entry;
    })
    .filter(Boolean);
  return next.length > 0 ? next : undefined;
}

function normalizePersistedFusionAnalysis(analysis) {
  if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) return undefined;
  const next = {};

  for (const key of FUSION_ANALYSIS_GROUP_KEYS) {
    const rawItems = Array.isArray(analysis[key]) ? analysis[key] : [];
    next[key] = rawItems
      .filter((item) => item && typeof item === "object")
      .map((item) => {
        const text = typeof item.text === "string" ? item.text.trim() : "";
        if (!text) return null;
        const models = Array.isArray(item.models)
          ? Array.from(new Set(
              item.models
                .filter((model) => typeof model === "string")
                .map((model) => model.trim())
                .filter((model) => FUSION_MODELS.has(model))
            ))
          : [];
        return { text, models };
      })
      .filter(Boolean);
  }

  return next;
}

function hasMeaningfulModelProgress(message, { content, parts, thinkingTimeline, citations, tools } = {}) {
  if (!message || message.role !== "model") return false;

  const normalizedContent = typeof content === "string"
    ? content.trim()
    : (typeof message.content === "string" ? message.content.trim() : "");
  if (normalizedContent && !PENDING_MESSAGE_TEXTS.has(normalizedContent)) {
    return true;
  }

  if (typeof message.thought === "string" && message.thought.trim()) {
    return true;
  }

  if (typeof message.searchError === "string" && message.searchError.trim()) {
    return true;
  }

  const normalizedParts = Array.isArray(parts) ? parts : (Array.isArray(message.parts) ? message.parts : []);
  if (normalizedParts.some((part) => {
    const text = typeof part?.text === "string" ? part.text.trim() : "";
    return text && !PENDING_MESSAGE_TEXTS.has(text);
  })) {
    return true;
  }

  const normalizedTimeline = Array.isArray(thinkingTimeline)
    ? thinkingTimeline
    : (Array.isArray(message.thinkingTimeline) ? message.thinkingTimeline : []);
  if (normalizedTimeline.length > 0) {
    return true;
  }

  const normalizedCitations = Array.isArray(citations)
    ? citations
    : (Array.isArray(message.citations) ? message.citations : []);
  if (normalizedCitations.length > 0) {
    return true;
  }

  const normalizedTools = Array.isArray(tools)
    ? tools
    : (Array.isArray(message.tools) ? message.tools : []);
  if (normalizedTools.length > 0) {
    return true;
  }

  if (Array.isArray(message.fusionExperts) && message.fusionExperts.length > 0) {
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

function normalizePersistedMessage(message) {
  if (!message || typeof message !== "object") return null;
  if (!ALLOWED_PERSISTED_ROLES.has(message.role)) return null;

  const content = typeof message.content === "string" ? message.content : "";
  const parts = normalizePersistedParts(message.parts, content);
  if (!parts || parts.length === 0) return null;

  const thinkingTimeline = normalizePersistedTimeline(message.thinkingTimeline);
  const citations = normalizePersistedCitations(message.citations);
  const tools = normalizePersistedTools(message.tools);
  const providerState = normalizePersistedProviderState(message.providerState);

  if (!hasMeaningfulModelProgress(message, { content, parts, thinkingTimeline, citations, tools })) {
    const normalizedContent = content.trim();
    const pendingOnly = message.role === "model"
      && (!normalizedContent || PENDING_MESSAGE_TEXTS.has(normalizedContent))
      && parts.every((part) => {
        const text = typeof part?.text === "string" ? part.text.trim() : "";
        return !text || PENDING_MESSAGE_TEXTS.has(text);
      });
    if (pendingOnly) {
      return null;
    }
  }

  const out = {
    role: message.role,
    type: ALLOWED_PERSISTED_TYPES.has(message.type) ? message.type : "parts",
    content,
    parts,
  };

  if (isNonEmptyString(message.id)) out.id = message.id;
  if (typeof message.thought === "string" && message.thought) out.thought = message.thought;

  if (citations) out.citations = citations;
  if (tools) out.tools = tools;
  if (providerState) out.providerState = providerState;

  if (Number.isFinite(message.searchContextTokens) && message.searchContextTokens > 0) {
    out.searchContextTokens = Math.max(0, Math.floor(message.searchContextTokens));
  }

  if (thinkingTimeline) out.thinkingTimeline = thinkingTimeline;

  const fusionExperts = normalizePersistedFusionExperts(message.fusionExperts);
  if (fusionExperts) out.fusionExperts = fusionExperts;

  const fusionAnalysis = normalizePersistedFusionAnalysis(message.fusionAnalysis);
  if (fusionAnalysis) out.fusionAnalysis = fusionAnalysis;

  return out;
}

export function buildPersistedConversationMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map(normalizePersistedMessage).filter(Boolean);
}
