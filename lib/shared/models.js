export const CLAUDE_OPUS_MODEL = "claude-opus-4-8";
export const GEMINI_FLASH_MODEL = "gemini-3.5-flash";
export const GPT_56_SOL_MODEL = "gpt-5.6-sol";
export const GROK_45_MODEL = "grok-4.5";
export const GLM_52_MODEL = "glm-5.2";
export const OPENROUTER_FUSION_MODEL = "openrouter/fusion";
export const FUSION_MODEL_ID = "fusion";
export const FUSION_PROVIDER = "fusion";
export const FUSION_SYNTHESIS_MODEL = OPENROUTER_FUSION_MODEL;
export const FUSION_SYNTHESIS_LABEL = "Fusion";
export const FUSION_MAX_ROUNDS = 1;

export const MODEL_GROUP_ORDER = ["fusion", "openai", "anthropic", "google", "xai", "zai"];

export const MODEL_GROUP_TITLES = Object.freeze({
  fusion: "Fusion",
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  xai: "xAI",
  zai: "Z.AI",
});

export const MODEL_DISPLAY_GROUP = Object.freeze({});

const CHAT_MODEL_DEFINITIONS = Object.freeze([
  {
    id: FUSION_MODEL_ID,
    name: "Fusion",
    provider: FUSION_PROVIDER,
    contextWindow: 0,
    nativeInputs: ["text"],
    supportsWebSearch: false,
    supportsToolUse: false,
    isFusion: true,
  },
  {
    id: GPT_56_SOL_MODEL,
    name: "GPT-5.6 Sol",
    provider: "openai",
    contextWindow: 1050000,
    nativeInputs: ["text", "image", "file"],
    supportsWebSearch: true,
    supportsToolUse: true,
  },
  {
    id: CLAUDE_OPUS_MODEL,
    name: "Claude Opus 4.8",
    provider: "anthropic",
    contextWindow: 1000000,
    nativeInputs: ["text", "image", "file"],
    supportsWebSearch: true,
    supportsToolUse: true,
  },
  {
    id: GEMINI_FLASH_MODEL,
    name: "Gemini 3.5 Flash",
    provider: "google",
    contextWindow: 1000000,
    nativeInputs: ["text", "image", "file"],
    supportsWebSearch: true,
    supportsToolUse: true,
  },
  {
    id: GROK_45_MODEL,
    name: "Grok 4.5",
    provider: "xai",
    contextWindow: 500000,
    nativeInputs: ["text", "image", "file"],
    supportsWebSearch: true,
    supportsToolUse: true,
  },
  {
    id: GLM_52_MODEL,
    name: "GLM-5.2",
    provider: "zai",
    contextWindow: 1000000,
    nativeInputs: ["text", "image", "file"],
    supportsWebSearch: true,
    supportsToolUse: true,
  },
  {
    id: OPENROUTER_FUSION_MODEL,
    name: "OpenRouter Fusion",
    provider: "openrouter",
    contextWindow: 1000000,
    nativeInputs: ["text"],
    supportsWebSearch: false,
    supportsToolUse: true,
    isHidden: true,
  },
]);

function createChatModelConfig(model) {
  const nativeInputs = Object.freeze(Array.from(new Set(model.nativeInputs || ["text"])));
  return Object.freeze({
    supportsAgentRuntime: false,
    supportsPlanning: false,
    supportsApprovalFlow: false,
    supportsMemory: false,
    supportsThinkingLevelControl: false,
    supportsMaxTokensControl: false,
    ...model,
    nativeInputs,
    supportsImages: nativeInputs.includes("image"),
    supportsDocuments: nativeInputs.includes("file"),
  });
}

export const CHAT_MODELS = Object.freeze(CHAT_MODEL_DEFINITIONS.map(createChatModelConfig));
export const PRIMARY_CHAT_MODELS = Object.freeze(CHAT_MODELS.filter((model) => !model.isHidden));
const PRIMARY_CHAT_MODEL_IDS = new Set(PRIMARY_CHAT_MODELS.map((model) => model.id));
export const DEFAULT_MODEL = GPT_56_SOL_MODEL;
export const DEFAULT_THINKING_LEVELS = Object.freeze({});

export function normalizeModelId(model) {
  if (typeof model !== "string") return model;
  return model.trim();
}

export function isFusionModel(model) {
  return normalizeModelId(model) === FUSION_MODEL_ID;
}

export function countCompletedFusionRounds(messages) {
  if (!Array.isArray(messages)) return 0;
  let rounds = 0;
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.role === "user" && messages[index + 1]?.role === "model") {
      rounds += 1;
      index += 1;
    }
  }
  return rounds;
}

export function isDirectChatModel(model) {
  const normalized = normalizeModelId(model);
  return PRIMARY_CHAT_MODEL_IDS.has(normalized) && normalized !== FUSION_MODEL_ID;
}

export function getModelConfig(modelId) {
  const normalized = normalizeModelId(modelId);
  return CHAT_MODELS.find((model) => model.id === normalized) || null;
}

export function getModelProvider(modelId) {
  return getModelConfig(modelId)?.provider || "";
}

export function isPrimaryChatModelId(modelId) {
  return PRIMARY_CHAT_MODEL_IDS.has(normalizeModelId(modelId));
}

export function getSelectableChatModels() {
  return PRIMARY_CHAT_MODELS;
}

export function getDefaultThinkingLevel(modelId) {
  return DEFAULT_THINKING_LEVELS[normalizeModelId(modelId)];
}

function getModelNativeInputs(modelId) {
  return getModelConfig(modelId)?.nativeInputs || ["text"];
}

export function modelSupportsAvailableInput(modelId, inputType) {
  const input = typeof inputType === "string" ? inputType.trim() : "";
  return Boolean(input && getModelNativeInputs(modelId).includes(input));
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
  [FUSION_MODEL_ID]: "max",
  [GPT_56_SOL_MODEL]: "max",
  [CLAUDE_OPUS_MODEL]: "max",
  [GEMINI_FLASH_MODEL]: "high",
  [GROK_45_MODEL]: "high",
  [GLM_52_MODEL]: "max",
  [OPENROUTER_FUSION_MODEL]: "max",
});

export function getMaxReasoningEffortForModel(modelId) {
  return MODEL_MAX_REASONING_EFFORT[normalizeModelId(modelId)] || "max";
}

export function getDefaultMaxTokensForModel() {
  return 128000;
}

const FUSION_EXPERT_BASES = Object.freeze([
  { key: "gpt", modelId: GPT_56_SOL_MODEL, label: "GPT-5.6 Sol", provider: "openai" },
  { key: "opus", modelId: CLAUDE_OPUS_MODEL, label: "Claude Opus 4.8", provider: "anthropic" },
  { key: "pro", modelId: GEMINI_FLASH_MODEL, label: "Gemini 3.5 Flash", provider: "google" },
]);

export function getFusionExpertConfigs() {
  return FUSION_EXPERT_BASES.map((expert) => ({ ...expert, thinkingLevel: getDefaultThinkingLevel(expert.modelId) }));
}

export const FUSION_EXPERTS = Object.freeze(getFusionExpertConfigs());

export function getFusionExpertDisplayLabel(expert) {
  const labels = { gpt: "GPT", opus: "Claude", pro: "Gemini" };
  return labels[expert?.key] || expert?.label || "专家";
}
