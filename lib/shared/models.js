export const CLAUDE_OPUS_MODEL = "anthropic/claude-opus-4.8";
export const GEMINI_FLASH_MODEL = "google/gemini-3.5-flash";
export const GPT_55_MODEL = "openai/gpt-5.5";
export const OPENAI_PRIMARY_MODEL = GPT_55_MODEL;
export const DEEPSEEK_V4_PRO_MODEL = "deepseek/deepseek-v4-pro";

export const CHAT_RUNTIME_MODE_CHAT = "chat";
export const DEFAULT_CHAT_RUNTIME_MODE = CHAT_RUNTIME_MODE_CHAT;

export const MODEL_GROUP_ORDER = ["anthropic", "google", "openai", "deepseek"];

export const MODEL_GROUP_TITLES = Object.freeze({
  anthropic: "Anthropic",
  google: "Google",
  openai: "OpenAI",
  deepseek: "DeepSeek",
});

export const MODEL_DISPLAY_GROUP = Object.freeze({});

export const CHAT_RUNTIME_MODES = Object.freeze([
  {
    id: CHAT_RUNTIME_MODE_CHAT,
    label: "Chat",
    description: "标准聊天模式",
  },
]);

export const MODEL_NATIVE_INPUT_LABELS = Object.freeze({
  text: "text",
  image: "image",
  file: "file",
  video: "video",
  audio: "audio",
});

const CHAT_MODEL_DEFINITIONS = Object.freeze([
  {
    id: CLAUDE_OPUS_MODEL,
    name: "Claude Opus 4.8",
    provider: "anthropic",
    contextWindow: 200000,
    nativeInputs: ["text", "image", "file"],
    supportsWebSearch: false,
    supportsAgentRuntime: false,
    supportsPlanning: false,
    supportsToolUse: true,
    supportsApprovalFlow: false,
    supportsMemory: false,
    supportsThinkingLevelControl: false,
    supportsMaxTokensControl: false,
  },
  {
    id: GEMINI_FLASH_MODEL,
    name: "Gemini 3.5 Flash",
    provider: "google",
    contextWindow: 1000000,
    nativeInputs: ["text", "image", "file"],
    supportsWebSearch: false,
    supportsAgentRuntime: false,
    supportsPlanning: false,
    supportsToolUse: true,
    supportsApprovalFlow: false,
    supportsMemory: false,
    supportsThinkingLevelControl: false,
    supportsMaxTokensControl: false,
  },
  {
    id: GPT_55_MODEL,
    name: "GPT 5.5",
    provider: "openai",
    contextWindow: 256000,
    nativeInputs: ["text", "image", "file"],
    supportsWebSearch: false,
    supportsAgentRuntime: false,
    supportsPlanning: false,
    supportsToolUse: true,
    supportsApprovalFlow: false,
    supportsMemory: false,
    supportsThinkingLevelControl: false,
    supportsMaxTokensControl: false,
  },
  {
    id: DEEPSEEK_V4_PRO_MODEL,
    name: "DeepSeek V4 Pro",
    provider: "deepseek",
    contextWindow: 128000,
    nativeInputs: ["text", "file"],
    supportsWebSearch: false,
    supportsAgentRuntime: false,
    supportsPlanning: false,
    supportsToolUse: true,
    supportsApprovalFlow: false,
    supportsMemory: false,
    supportsThinkingLevelControl: false,
    supportsMaxTokensControl: false,
  },
]);

const LEGACY_TEXT_MODEL = ["Mini", "Max-M3"].join("");
const LEGACY_IMAGE_MODEL = ["image", "01"].join("-");
const LEGACY_QWEN_MODEL = "qwen3.7-plus";
const LEGACY_WAN_MODEL = "wan2.7-image-pro";

const LEGACY_MODEL_IDS = new Set([
  LEGACY_TEXT_MODEL,
  LEGACY_IMAGE_MODEL,
  LEGACY_QWEN_MODEL,
  LEGACY_WAN_MODEL,
  "council",
  "gpt-image-2",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "gemini-3.5-flash",
  "gpt-5.5",
  "deepseek-v4-pro",
  "doubao-seed-2-0-lite-260428",
]);

function createChatModelConfig(model) {
  const nativeInputs = Object.freeze(
    Array.isArray(model?.nativeInputs) && model.nativeInputs.length > 0
      ? Array.from(new Set(
        model.nativeInputs
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean)
      ))
      : ["text"]
  );

  return Object.freeze({
    ...model,
    nativeInputs,
    supportsImages: nativeInputs.includes("image"),
    supportsDocuments: nativeInputs.includes("file"),
  });
}

export const CHAT_MODELS = Object.freeze(CHAT_MODEL_DEFINITIONS.map(createChatModelConfig));

export const PRIMARY_CHAT_MODELS = Object.freeze(CHAT_MODELS);
const PRIMARY_CHAT_MODEL_IDS = new Set(PRIMARY_CHAT_MODELS.map((model) => model.id));

export const DEFAULT_MODEL = GPT_55_MODEL;

export const DEFAULT_THINKING_LEVELS = Object.freeze(
  CHAT_MODELS.reduce((acc, model) => {
    if (model.defaultThinkingLevel) {
      acc[model.id] = model.defaultThinkingLevel;
    }
    return acc;
  }, {})
);

export function normalizeModelId(model) {
  if (typeof model !== "string") return model;
  const normalized = model.trim();
  if (LEGACY_MODEL_IDS.has(normalized)) return DEFAULT_MODEL;
  return normalized;
}

export function isZenMuxChatModel(model) {
  const normalized = normalizeModelId(model);
  return typeof normalized === "string" && PRIMARY_CHAT_MODEL_IDS.has(normalized);
}

export function resolveUsableModelId(modelId, fallbackModelId = DEFAULT_MODEL) {
  const normalized = normalizeModelId(modelId);
  if (typeof normalized === "string" && getModelConfig(normalized)) {
    return normalized;
  }
  return normalizeModelId(fallbackModelId);
}

export function getModelConfig(modelId) {
  const normalized = normalizeModelId(modelId);
  return CHAT_MODELS.find((model) => model.id === normalized) || null;
}

export function getModelProvider(modelId) {
  return getModelConfig(modelId)?.provider || "";
}

export function isPrimaryChatModelId(modelId) {
  const normalized = normalizeModelId(modelId);
  return typeof normalized === "string" && PRIMARY_CHAT_MODEL_IDS.has(normalized);
}

export function getSelectableChatModels() {
  return PRIMARY_CHAT_MODELS;
}

export function getGroupedSelectableModels() {
  const models = getSelectableChatModels();
  const grouped = new Map();
  for (const provider of MODEL_GROUP_ORDER) {
    const items = models.filter((m) => m.provider === provider);
    if (items.length > 0) {
      grouped.set(provider, items);
    }
  }
  for (const m of models) {
    if (!MODEL_GROUP_ORDER.includes(m.provider)) {
      if (!grouped.has(m.provider)) grouped.set(m.provider, []);
      grouped.get(m.provider).push(m);
    }
  }
  return grouped;
}

export function getDefaultThinkingLevel(modelId) {
  return DEFAULT_THINKING_LEVELS[normalizeModelId(modelId)];
}

export function normalizeChatRuntimeMode(mode) {
  return CHAT_RUNTIME_MODE_CHAT;
}

function getModelNativeInputs(modelId) {
  return getModelConfig(modelId)?.nativeInputs || ["text"];
}

function modelSupportsNativeInput(modelId, inputType) {
  const normalizedInput = typeof inputType === "string" ? inputType.trim() : "";
  if (!normalizedInput) return false;
  return getModelNativeInputs(modelId).includes(normalizedInput);
}

function getModelAvailableInputs(modelId) {
  const availableInputs = ["text"];

  if (modelSupportsNativeInput(modelId, "image")) {
    availableInputs.push("image");
  }

  if (modelSupportsNativeInput(modelId, "video")) {
    availableInputs.push("video");
  }

  if (modelSupportsNativeInput(modelId, "audio")) {
    availableInputs.push("audio");
  }

  if (modelSupportsNativeInput(modelId, "file")) {
    availableInputs.push("file");
  }

  return availableInputs;
}

export function modelSupportsAvailableInput(modelId, inputType) {
  const normalizedInput = typeof inputType === "string" ? inputType.trim() : "";
  if (!normalizedInput) return false;
  return getModelAvailableInputs(modelId).includes(normalizedInput);
}

export function getModelAttachmentSupport(modelId) {
  const supportsImages = modelSupportsAvailableInput(modelId, "image");
  const supportsDocuments = modelSupportsAvailableInput(modelId, "file");
  const supportsVideo = modelSupportsAvailableInput(modelId, "video");
  const supportsAudio = modelSupportsAvailableInput(modelId, "audio");

  return {
    supportsImages,
    supportsDocuments,
    supportsVideo,
    supportsAudio,
    supportsFilePicker: supportsImages || supportsDocuments || supportsVideo || supportsAudio,
  };
}

export function getDefaultMaxTokensForModel(modelId) {
  const normalized = normalizeModelId(modelId);
  if (typeof normalized !== "string" || !normalized) return 64000;
  if (normalized === GPT_55_MODEL) {
    return 65536;
  }
  return 64000;
}
