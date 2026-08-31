const OPENROUTER_ROOT_URL = "https://openrouter.ai/api";
const OPENROUTER_OPENAI_BASE_URL = `${OPENROUTER_ROOT_URL}/v1`;
const VECTAIX_CODEX_BASE_URL = "https://llmrouter.vectaix.com/api/codex/v1";
const ABLITERATION_OPENAI_BASE_URL = "https://api.abliteration.ai/v1";
const QWEN_WORKSPACE_ROOT_URL = "https://ws-2t7yj3g991jc5yo6.ap-southeast-1.maas.aliyuncs.com";
const QWEN_CHAT_OPENAI_BASE_URL = `${QWEN_WORKSPACE_ROOT_URL}/compatible-mode/v1`;
const QWEN_AUDIO_BASE_URL = `${QWEN_WORKSPACE_ROOT_URL}/api/v1`;
const QWEN_IMAGE_GENERATION_URL = `${QWEN_WORKSPACE_ROOT_URL}/api/v1/services/aigc/multimodal-generation/generation`;
const HAPPYHORSE_VIDEO_GENERATION_URL = `${QWEN_WORKSPACE_ROOT_URL}/api/v1/services/aigc/video-generation/video-synthesis`;
const HAPPYHORSE_TASKS_URL = `${QWEN_WORKSPACE_ROOT_URL}/api/v1/tasks`;
const MINIMAX_AUDIO_GENERATION_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
const AI_MEDIAKIT_BASE_URL = "https://mediakit.cn-beijing.volces.com";
const DOUBAO_AUDIO_GENERATION_URL = "https://openspeech.bytedance.com/api/v3/tts/create";

function readRequiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function resolveOpenRouterOpenAIConfig() {
  return {
    apiKey: readRequiredEnv("OPENROUTER_API_KEY"),
    openAIBaseUrl: OPENROUTER_OPENAI_BASE_URL,
  };
}

export function resolveVectaixCodexConfig() {
  const apiKey = process.env.VECTAIX_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GPT 模型服务尚未配置，请联系管理员");
  }
  return { apiKey, openAIBaseUrl: VECTAIX_CODEX_BASE_URL };
}

export function resolveAbliterationOpenAIConfig() {
  const apiKey = process.env.ABLIT_KEY?.trim();
  if (!apiKey) {
    throw new Error("Abliteration API 密钥尚未配置，请在 Zeabur 环境变量中设置 ABLIT_KEY");
  }
  return {
    apiKey,
    openAIBaseUrl: ABLITERATION_OPENAI_BASE_URL,
  };
}

export function resolveQwenChatConfig() {
  return {
    apiKey: readRequiredEnv("DASHSCOPE_SINGAPORE_API_KEY"),
    openAIBaseUrl: QWEN_CHAT_OPENAI_BASE_URL,
  };
}

export function resolveQwenAudioConfig() {
  return {
    apiKey: readRequiredEnv("DASHSCOPE_SINGAPORE_API_KEY"),
    baseUrl: QWEN_AUDIO_BASE_URL,
  };
}

export function resolveQwenImageConfig() {
  const apiKey = process.env.DASHSCOPE_SINGAPORE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("千问图片服务尚未配置，请在 Zeabur 环境变量中设置 DASHSCOPE_SINGAPORE_API_KEY");
  }
  return {
    apiKey,
    endpoint: QWEN_IMAGE_GENERATION_URL,
  };
}

export function resolveHappyHorseVideoConfig() {
  const apiKey = process.env.DASHSCOPE_SINGAPORE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("HappyHorse 视频服务尚未配置，请在 Zeabur 环境变量中设置 DASHSCOPE_SINGAPORE_API_KEY");
  }
  return {
    apiKey,
    createEndpoint: HAPPYHORSE_VIDEO_GENERATION_URL,
    tasksEndpoint: HAPPYHORSE_TASKS_URL,
  };
}

export function resolveMinimaxAudioConfig() {
  const apiKey = process.env.DASHSCOPE_BEIJING_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("MiniMax 语音服务尚未配置，请在 Zeabur 环境变量中设置 DASHSCOPE_BEIJING_API_KEY");
  }
  return {
    apiKey,
    endpoint: MINIMAX_AUDIO_GENERATION_URL,
  };
}

export function resolveDoubaoAudioConfig() {
  const apiKey = process.env.DOUBAO_AUDIO_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("豆包音频服务尚未配置，请在 Zeabur 环境变量中设置 DOUBAO_AUDIO_API_KEY");
  }
  return {
    apiKey,
    endpoint: DOUBAO_AUDIO_GENERATION_URL,
  };
}

export function resolveAiMediaKitConfig() {
  const apiKey = process.env.AI_MEDIAKIT_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("AI MediaKit 服务尚未配置，请在 Zeabur 环境变量中设置 AI_MEDIAKIT_API_KEY");
  }
  return {
    apiKey,
    baseUrl: AI_MEDIAKIT_BASE_URL,
  };
}

export function resolvePublicAppUrl() {
  const configured = process.env.PUBLIC_APP_URL?.trim();
  if (!configured) throw new Error("PUBLIC_APP_URL 尚未配置");
  let parsed;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error("PUBLIC_APP_URL 必须是有效的 HTTPS 域名");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
  ) {
    throw new Error("PUBLIC_APP_URL 必须是没有路径、参数或锚点的 HTTPS 域名");
  }
  return parsed.origin;
}
