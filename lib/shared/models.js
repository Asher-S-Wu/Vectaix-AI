export const CLAUDE_OPUS_MODEL = "claude-opus-4-7";
export const CLAUDE_OPUS_4_6_MODEL = "claude-opus-4-6";
export const GEMINI_PRO_MODEL = "gemini-3.1-pro-preview";
export const DEEPSEEK_V4_PRO_MODEL = "deepseek-v4-pro";
export const OPENAI_PRIMARY_MODEL = "gpt-5.5";
export const SEED_MODEL_ID = "doubao-seed-2-0-lite-260428";
export const GPT_IMAGE_2_MODEL = "gpt-image-2";
export const COUNCIL_MODEL_ID = "council";
export const COUNCIL_PROVIDER = "council";
export const COUNCIL_MAX_ROUNDS = 8;
export const DEFAULT_SEED_THINKING_LEVEL = "high";
export const CHAT_RUNTIME_MODE_CHAT = "chat";
export const DEFAULT_CHAT_RUNTIME_MODE = CHAT_RUNTIME_MODE_CHAT;

export const SEED_REASONING_LEVELS = ["minimal", "low", "medium", "high"];
export const SEED_REASONING_LABELS = {
  minimal: "最小",
  low: "低",
  medium: "中",
  high: "高",
};

export const MODEL_GROUP_ORDER = ["openai", "claude", "gemini", "deepseek", "seed"];

export const MODEL_GROUP_TITLES = Object.freeze({
  openai: "OpenAI",
  claude: "Anthropic",
  gemini: "Google",
  deepseek: "DeepSeek",
  seed: "ByteDance",
});

export const MODEL_DISPLAY_GROUP = Object.freeze({
  "image-gen": "openai",
});

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
    id: COUNCIL_MODEL_ID,
    name: "Council",
    provider: COUNCIL_PROVIDER,
    contextWindow: 0,
    nativeInputs: ["text", "image"],
    supportsImages: true,
    supportsDocuments: false,
    supportsWebSearch: true,
    supportsAgentRuntime: false,
    supportsPlanning: false,
    supportsToolUse: false,
    supportsApprovalFlow: false,
    supportsMemory: false,
    supportsThinkingLevelControl: false,
    supportsMaxTokensControl: false,
    isCouncil: true,
  },
  {
    id: OPENAI_PRIMARY_MODEL,
    name: "GPT-5.5",
    provider: "openai",
    contextWindow: 1000000,
    nativeInputs: ["text", "image", "file"],
    supportsImages: true,
    supportsDocuments: true,
    supportsWebSearch: true,
    supportsAgentRuntime: false,
    supportsPlanning: false,
    supportsToolUse: false,
    supportsApprovalFlow: false,
    supportsMemory: false,
    supportsThinkingLevelControl: true,
    supportsMaxTokensControl: true,
    defaultThinkingLevel: "xhigh",
  },
  {
    id: GPT_IMAGE_2_MODEL,
    name: "GPT-Image-2",
    provider: "image-gen",
    contextWindow: 0,
    nativeInputs: ["text", "image"],
    supportsImages: true,
    supportsDocuments: false,
    supportsWebSearch: false,
    supportsAgentRuntime: false,
    supportsPlanning: false,
    supportsToolUse: false,
    supportsApprovalFlow: false,
    supportsMemory: false,
    supportsThinkingLevelControl: false,
    supportsMaxTokensControl: false,
    isImageGen: true,
  },
  {
    id: CLAUDE_OPUS_MODEL,
    name: "Claude Opus 4.7",
    provider: "claude",
    contextWindow: 1000000,
    nativeInputs: ["text", "image", "file"],
    supportsImages: true,
    supportsDocuments: true,
    supportsWebSearch: true,
    supportsAgentRuntime: false,
    supportsPlanning: false,
    supportsToolUse: false,
    supportsApprovalFlow: false,
    supportsMemory: false,
    supportsThinkingLevelControl: true,
    supportsMaxTokensControl: true,
    defaultThinkingLevel: "max",
  },
  {
    id: CLAUDE_OPUS_4_6_MODEL,
    name: "Claude Opus 4.6",
    provider: "claude",
    contextWindow: 1000000,
    nativeInputs: ["text", "image", "file"],
    supportsImages: true,
    supportsDocuments: true,
    supportsWebSearch: true,
    supportsAgentRuntime: false,
    supportsPlanning: false,
    supportsToolUse: false,
    supportsApprovalFlow: false,
    supportsMemory: false,
    supportsThinkingLevelControl: true,
    supportsMaxTokensControl: true,
    defaultThinkingLevel: "max",
  },
  {
    id: GEMINI_PRO_MODEL,
    name: "Gemini 3.1 Pro",
    provider: "gemini",
    contextWindow: 1000000,
    nativeInputs: ["text", "image", "file", "video", "audio"],
    supportsImages: true,
    supportsDocuments: true,
    supportsWebSearch: true,
    supportsAgentRuntime: false,
    supportsPlanning: false,
    supportsToolUse: false,
    supportsApprovalFlow: false,
    supportsMemory: false,
    supportsThinkingLevelControl: true,
    supportsMaxTokensControl: true,
    defaultThinkingLevel: "high",
  },
  {
    id: DEEPSEEK_V4_PRO_MODEL,
    name: "DeepSeek V4 Pro",
    provider: "deepseek",
    contextWindow: 1000000,
    nativeInputs: ["text"],
    supportsImages: false,
    supportsDocuments: false,
    supportsWebSearch: true,
    supportsAgentRuntime: false,
    supportsPlanning: false,
    supportsToolUse: false,
    supportsApprovalFlow: false,
    supportsMemory: false,
    supportsThinkingLevelControl: false,
    supportsMaxTokensControl: true,
    defaultThinkingLevel: "max",
  },
  {
    id: SEED_MODEL_ID,
    name: "Doubao-Seed-2.0-lite",
    provider: "seed",
    contextWindow: 256000,
    nativeInputs: ["text", "image", "video"],
    supportsImages: true,
    supportsDocuments: false,
    supportsWebSearch: true,
    supportsAgentRuntime: false,
    supportsPlanning: false,
    supportsToolUse: false,
    supportsApprovalFlow: false,
    supportsMemory: false,
    supportsThinkingLevelControl: true,
    supportsMaxTokensControl: true,
    defaultThinkingLevel: "high",
  },
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

export const DEFAULT_MODEL = SEED_MODEL_ID;

export const DEFAULT_THINKING_LEVELS = Object.freeze(
  CHAT_MODELS.reduce((acc, model) => {
    if (model.defaultThinkingLevel) {
      acc[model.id] = model.defaultThinkingLevel;
    }
    return acc;
  }, {})
);

const COUNCIL_EXPERT_BASES = Object.freeze([
  {
    key: "gpt",
    modelId: OPENAI_PRIMARY_MODEL,
    label: "GPT-5.5",
    provider: "openai",
  },
  {
    key: "opus",
    modelId: CLAUDE_OPUS_MODEL,
    label: "Claude Opus 4.7",
    provider: "claude",
  },
  {
    key: "pro",
    modelId: GEMINI_PRO_MODEL,
    label: "Gemini 3.1 Pro",
    provider: "gemini",
  },
]);

export function getCouncilExpertConfigs() {
  return COUNCIL_EXPERT_BASES.map((expert) => ({
    ...expert,
    thinkingLevel: getDefaultThinkingLevel(expert.modelId),
  }));
}

export const COUNCIL_EXPERTS = Object.freeze(getCouncilExpertConfigs());

const COUNCIL_EXPERT_DISPLAY_LABELS = Object.freeze({
  gpt: "GPT",
  opus: "Claude",
  pro: "Gemini",
  [OPENAI_PRIMARY_MODEL]: "GPT",
  [CLAUDE_OPUS_MODEL]: "Claude",
  [CLAUDE_OPUS_4_6_MODEL]: "Claude",
  [GEMINI_PRO_MODEL]: "Gemini",
});

export function normalizeModelId(model) {
  if (typeof model !== "string") return model;
  const normalized = model.trim();
  return normalized;
}

export function resolveUsableModelId(modelId, fallbackModelId = DEFAULT_MODEL) {
  const normalized = normalizeModelId(modelId);
  if (typeof normalized === "string" && getModelConfig(normalized)) {
    return normalized;
  }
  return normalizeModelId(fallbackModelId);
}

export function isSeedModel(model) {
  return normalizeModelId(model) === SEED_MODEL_ID;
}

export function isCouncilModel(model) {
  return typeof model === "string" && model === COUNCIL_MODEL_ID;
}

export function isImageGenModel(modelId) {
  return getModelConfig(modelId)?.isImageGen === true;
}

export function countCompletedCouncilRounds(messages) {
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

export function getModelConfig(modelId) {
  const normalized = normalizeModelId(modelId);
  return CHAT_MODELS.find((model) => model.id === normalized) || null;
}

export function getModelProvider(modelId) {
  return getModelConfig(modelId)?.provider || "";
}

export function isClaudeOpusModel(modelId) {
  const normalized = normalizeModelId(modelId);
  return normalized === CLAUDE_OPUS_MODEL || normalized === CLAUDE_OPUS_4_6_MODEL;
}

export function isPrimaryChatModelId(modelId) {
  const normalized = normalizeModelId(modelId);
  return typeof normalized === "string" && PRIMARY_CHAT_MODEL_IDS.has(normalized);
}

export function getSelectableChatModels() {
  return PRIMARY_CHAT_MODELS;
}

export function isAgentBackedModelId(modelId) {
  const normalized = normalizeModelId(modelId);
  return Boolean(getModelConfig(normalized)) && normalized !== COUNCIL_MODEL_ID;
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

export function getCouncilExpertDisplayLabel(expert) {
  const key = typeof expert?.key === "string" ? expert.key : "";
  const modelId = normalizeModelId(expert?.modelId);
  const rawLabel = typeof expert?.label === "string" ? expert.label : "";

  if (key && COUNCIL_EXPERT_DISPLAY_LABELS[key]) {
    return COUNCIL_EXPERT_DISPLAY_LABELS[key];
  }
  if (modelId && COUNCIL_EXPERT_DISPLAY_LABELS[modelId]) {
    return COUNCIL_EXPERT_DISPLAY_LABELS[modelId];
  }
  if (/gpt|chatgpt/i.test(rawLabel)) return "GPT";
  if (/claude/i.test(rawLabel)) return "Claude";
  if (/gemini/i.test(rawLabel)) return "Gemini";
  if (/seed|doubao/i.test(rawLabel)) return "Seed";
  return rawLabel || "专家";
}

export function getDefaultMaxTokensForModel(modelId) {
  const normalized = normalizeModelId(modelId);
  if (typeof normalized !== "string" || !normalized) return 64000;
  if (normalized === OPENAI_PRIMARY_MODEL || isClaudeOpusModel(normalized)) {
    return 128000;
  }
  if (normalized === SEED_MODEL_ID) {
    return 32768;
  }
  if (normalized === GEMINI_PRO_MODEL) {
    return 65536;
  }
  if (normalized === DEEPSEEK_V4_PRO_MODEL) {
    return 384000;
  }
  return 64000;
}
