export const CLAUDE_OPUS_MODEL = "anthropic/claude-opus-4.8";
export const GEMINI_FLASH_MODEL = "google/gemini-3.5-flash";
export const GPT_55_MODEL = "openai/gpt-5.5";
export const OPENAI_PRIMARY_MODEL = GPT_55_MODEL;
export const DOUBAO_SEED_21_PRO_MODEL = "doubao-seed-2-1-pro-260628";
export const SEED_MODEL_ID = DOUBAO_SEED_21_PRO_MODEL;
export const OPENROUTER_FUSION_MODEL = "openrouter/fusion";
export const SEED_REASONING_LEVELS = Object.freeze(["low", "medium", "high", "xhigh"]);
export const FUSION_MODEL_ID = "fusion";
export const FUSION_PROVIDER = "fusion";
export const FUSION_SYNTHESIS_MODEL = OPENROUTER_FUSION_MODEL;
export const FUSION_SYNTHESIS_LABEL = "Fusion";
export const FUSION_MAX_ROUNDS = 1;

export const CHAT_RUNTIME_MODE_CHAT = "chat";
export const DEFAULT_CHAT_RUNTIME_MODE = CHAT_RUNTIME_MODE_CHAT;

export const MODEL_GROUP_ORDER = ["fusion", "anthropic", "google", "openai", "openrouter", "ark"];

export const MODEL_GROUP_TITLES = Object.freeze({
  fusion: "Fusion",
  anthropic: "Anthropic",
  google: "Google",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  ark: "火山方舟",
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
    id: FUSION_MODEL_ID,
    name: "Fusion",
    provider: FUSION_PROVIDER,
    contextWindow: 0,
    nativeInputs: ["text"],
    supportsWebSearch: false,
    supportsAgentRuntime: false,
    supportsPlanning: false,
    supportsToolUse: false,
    supportsApprovalFlow: false,
    supportsMemory: false,
    supportsThinkingLevelControl: false,
    supportsMaxTokensControl: false,
    isFusion: true,
  },
  {
    id: CLAUDE_OPUS_MODEL,
    name: "Claude Opus 4.8",
    provider: "anthropic",
    contextWindow: 200000,
    nativeInputs: ["text", "image", "file"],
    supportsWebSearch: true,
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
    supportsWebSearch: true,
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
    supportsWebSearch: true,
    supportsAgentRuntime: false,
    supportsPlanning: false,
    supportsToolUse: true,
    supportsApprovalFlow: false,
    supportsMemory: false,
    supportsThinkingLevelControl: false,
    supportsMaxTokensControl: false,
  },
  {
    id: OPENROUTER_FUSION_MODEL,
    name: "OpenRouter Fusion",
    provider: "openrouter",
    contextWindow: 1000000,
    nativeInputs: ["text"],
    supportsWebSearch: false,
    supportsAgentRuntime: false,
    supportsPlanning: false,
    supportsToolUse: true,
    supportsApprovalFlow: false,
    supportsMemory: false,
    supportsThinkingLevelControl: false,
    supportsMaxTokensControl: false,
    isHidden: true,
  },
  {
    id: DOUBAO_SEED_21_PRO_MODEL,
    name: "Doubao Seed 2.1 Pro",
    provider: "ark",
    contextWindow: 128000,
    nativeInputs: ["text", "image", "file"],
    supportsWebSearch: true,
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

const LEGACY_MODEL_IDS = new Set([
  LEGACY_TEXT_MODEL,
  LEGACY_IMAGE_MODEL,
  "gpt-image-2",
  "gemini-3.5-flash",
  "gpt-5.5",
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

export const PRIMARY_CHAT_MODELS = Object.freeze(CHAT_MODELS.filter((model) => !model.isHidden));
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
  if (normalized === FUSION_MODEL_ID) return FUSION_MODEL_ID;
  if (LEGACY_MODEL_IDS.has(normalized)) return DEFAULT_MODEL;
  return normalized;
}

export function isFusionModel(model) {
  return typeof model === "string" && model.trim() === FUSION_MODEL_ID;
}

export function isClaudeOpusModel(model) {
  return normalizeModelId(model) === CLAUDE_OPUS_MODEL;
}

export function countCompletedFusionRounds(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return 0;

  let rounds = 0;
  for (let index = 0; index < messages.length; index += 1) {
    const userMessage = messages[index];
    const modelMessage = messages[index + 1];
    if (userMessage?.role !== "user") continue;
    if (modelMessage?.role !== "model") continue;
    rounds += 1;
    index += 1;
  }

  return rounds;
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

export const MODEL_MAX_REASONING_EFFORT = Object.freeze({
  [CLAUDE_OPUS_MODEL]: "max",
  [GEMINI_FLASH_MODEL]: "high",
  [GPT_55_MODEL]: "xhigh",
  [DOUBAO_SEED_21_PRO_MODEL]: "xhigh",
  [OPENROUTER_FUSION_MODEL]: "high",
});

export function getMaxReasoningEffortForModel(modelId) {
  const normalized = normalizeModelId(modelId);
  if (typeof normalized !== "string" || !normalized) return "xhigh";
  return MODEL_MAX_REASONING_EFFORT[normalized] || "xhigh";
}

export function getDefaultMaxTokensForModel(modelId) {
  const normalized = normalizeModelId(modelId);
  if (typeof normalized !== "string" || !normalized) return 64000;
  if (normalized === GPT_55_MODEL) {
    return 65536;
  }
  return 64000;
}

const FUSION_EXPERT_BASES = Object.freeze([
  {
    key: "gpt",
    modelId: GPT_55_MODEL,
    label: "GPT 5.5",
    provider: "openai",
  },
  {
    key: "opus",
    modelId: CLAUDE_OPUS_MODEL,
    label: "Claude Opus 4.8",
    provider: "anthropic",
  },
  {
    key: "pro",
    modelId: GEMINI_FLASH_MODEL,
    label: "Gemini 3.5 Flash",
    provider: "google",
  },
]);

export function getFusionExpertConfigs() {
  return FUSION_EXPERT_BASES.map((expert) => ({
    ...expert,
    thinkingLevel: getDefaultThinkingLevel(expert.modelId),
  }));
}

export const FUSION_EXPERTS = Object.freeze(getFusionExpertConfigs());

const FUSION_EXPERT_DISPLAY_LABELS = Object.freeze({
  gpt: "GPT",
  opus: "Claude",
  pro: "Gemini",
  [GPT_55_MODEL]: "GPT",
  [CLAUDE_OPUS_MODEL]: "Claude",
  [GEMINI_FLASH_MODEL]: "Gemini",
});

export function getFusionExpertDisplayLabel(expert) {
  const key = typeof expert?.key === "string" ? expert.key : "";
  const modelId = normalizeModelId(expert?.modelId);
  const rawLabel = typeof expert?.label === "string" ? expert.label : "";

  if (key && FUSION_EXPERT_DISPLAY_LABELS[key]) {
    return FUSION_EXPERT_DISPLAY_LABELS[key];
  }
  if (modelId && FUSION_EXPERT_DISPLAY_LABELS[modelId]) {
    return FUSION_EXPERT_DISPLAY_LABELS[modelId];
  }
  if (/gpt|chatgpt/i.test(rawLabel)) return "GPT";
  if (/claude/i.test(rawLabel)) return "Claude";
  if (/gemini/i.test(rawLabel)) return "Gemini";
  if (/doubao|seed/i.test(rawLabel)) return "Doubao";
  return rawLabel || "专家";
}
