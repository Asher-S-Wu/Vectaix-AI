import { MEDIA_MODELS } from "@/lib/media/shared/models";

export const CLAUDE_OPUS_5_MODEL = "claude-opus-5";
export const GEMINI_FLASH_MODEL = "google/gemini-3.7-flash";
export const GPT_56_SOL_MODEL = "gpt-5.6-sol";
export const ABLITERATED_LARGE_MODEL = "abliterated-model-large";
export const GROK_46_MODEL = "grok-4.6";
export const KIMI_K3_MODEL = "kimi-k3";
export const QWEN_38_MAX_MODEL = "qwen-3.8-max";

export const MODEL_GROUP_ORDER = [
  "openai",
  "abliteration",
  "anthropic",
  "google",
  "xai",
  "moonshot",
  "qwen",
];

export const MODEL_GROUP_TITLES = Object.freeze({
  openai: "OpenAI",
  abliteration: "Abliteration AI",
  anthropic: "Anthropic",
  google: "Google",
  xai: "xAI",
  moonshot: "Moonshot AI",
  qwen: "Qwen",
});

const CHAT_MODEL_DEFINITIONS = Object.freeze([
  {
    id: GPT_56_SOL_MODEL,
    name: "GPT-5.6 Sol",
    provider: "openai",
    nativeInputs: ["text", "image"],
    supportsWebSearch: true,
  },
  {
    id: ABLITERATED_LARGE_MODEL,
    name: "Abliterated Model Large",
    provider: "abliteration",
    contextWindow: 1_000_000,
    maxOutputTokens: 131_072,
    nativeInputs: ["text"],
    supportsReasoning: true,
    supportsToolUse: true,
    supportsVision: false,
    supportsVideo: false,
    supportsAudio: false,
    supportsWebSearch: true,
    supportsLogprobs: false,
    supportsReasoningEffort: true,
  },
  {
    id: CLAUDE_OPUS_5_MODEL,
    name: "Claude Opus 5",
    provider: "anthropic",
    nativeInputs: ["text", "image"],
    supportsWebSearch: true,
  },
  {
    id: GEMINI_FLASH_MODEL,
    name: "Gemini 3.7 Flash",
    provider: "google",
    nativeInputs: ["text", "image", "audio", "video"],
    supportsWebSearch: true,
  },
  {
    id: GROK_46_MODEL,
    name: "Grok 4.6",
    provider: "xai",
    nativeInputs: ["text", "image"],
    supportsWebSearch: true,
  },
  {
    id: KIMI_K3_MODEL,
    name: "Kimi K3",
    provider: "moonshot",
    nativeInputs: ["text", "image"],
    supportsWebSearch: true,
  },
  {
    id: QWEN_38_MAX_MODEL,
    name: "Qwen 3.8 Max",
    provider: "qwen",
    nativeInputs: ["text", "image"],
    supportsWebSearch: true,
  },
  ...MEDIA_MODELS,
]);

function createChatModelConfig(model) {
  const nativeInputs = Object.freeze(Array.from(new Set(model.nativeInputs || ["text"])));
  return Object.freeze({
    ...model,
    nativeInputs,
  });
}

export const CHAT_MODELS = Object.freeze(CHAT_MODEL_DEFINITIONS.map(createChatModelConfig));
const PRIMARY_CHAT_MODEL_IDS = new Set(CHAT_MODELS.map((model) => model.id));
const DIRECT_CHAT_MODEL_IDS = new Set(
  CHAT_MODELS.filter((model) => !model.mediaType).map((model) => model.id)
);
export const DEFAULT_MODEL = GEMINI_FLASH_MODEL;

export function normalizeModelId(model) {
  if (typeof model !== "string") return model;
  return model.trim();
}

export function isDirectChatModel(model) {
  return DIRECT_CHAT_MODEL_IDS.has(normalizeModelId(model));
}

export function getModelConfig(modelId) {
  const normalized = normalizeModelId(modelId);
  return CHAT_MODELS.find((model) => model.id === normalized) || null;
}

export function getModelProvider(modelId) {
  return getModelConfig(modelId)?.provider || "";
}

export function isMediaGenerationModel(modelId) {
  return Boolean(getModelConfig(modelId)?.mediaType);
}

export function isImageGenerationModel(modelId) {
  return getModelConfig(modelId)?.mediaType === "image";
}

export function isVideoGenerationModel(modelId) {
  return getModelConfig(modelId)?.mediaType === "video";
}

export function isPrimaryChatModelId(modelId) {
  return PRIMARY_CHAT_MODEL_IDS.has(normalizeModelId(modelId));
}

export function resolveUsableModelId(modelId, fallbackModelId = DEFAULT_MODEL) {
  const normalizedModel = normalizeModelId(modelId);
  if (PRIMARY_CHAT_MODEL_IDS.has(normalizedModel)) return normalizedModel;

  const normalizedFallback = normalizeModelId(fallbackModelId);
  return PRIMARY_CHAT_MODEL_IDS.has(normalizedFallback) ? normalizedFallback : DEFAULT_MODEL;
}

export function getSelectableChatModels() {
  return CHAT_MODELS;
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
  const supportsVideo = modelSupportsAvailableInput(modelId, "video");
  const supportsAudio = modelSupportsAvailableInput(modelId, "audio");
  return {
    supportsImages,
    supportsVideo,
    supportsAudio,
    supportsFilePicker: supportsImages || supportsVideo || supportsAudio,
  };
}
