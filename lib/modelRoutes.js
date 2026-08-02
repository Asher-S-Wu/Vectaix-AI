const INFERERA_ROOT_URL = "https://api.inferera.com";
const AIHUBMIX_ROOT_URL = "https://aihubmix.com";
const AIHUBMIX_OPENAI_BASE_URL = `${AIHUBMIX_ROOT_URL}/v1`;
const ABLITERATION_OPENAI_BASE_URL = "https://api.abliteration.ai/v1";
const QWEN_WORKSPACE_ROOT_URL = "https://ws-2t7yj3g991jc5yo6.ap-southeast-1.maas.aliyuncs.com";
const QWEN_AUDIO_BASE_URL = `${QWEN_WORKSPACE_ROOT_URL}/api/v1`;
const QWEN_IMAGE_GENERATION_URL = `${QWEN_WORKSPACE_ROOT_URL}/api/v1/services/aigc/multimodal-generation/generation`;
const HAPPYHORSE_VIDEO_GENERATION_URL = `${QWEN_WORKSPACE_ROOT_URL}/api/v1/services/aigc/video-generation/video-synthesis`;
const HAPPYHORSE_TASKS_URL = `${QWEN_WORKSPACE_ROOT_URL}/api/v1/tasks`;

function readRequiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function resolveInfereraOpenAIConfig() {
  return {
    apiKey: readRequiredEnv("AIHUBMIX_API_KEY"),
    openAIBaseUrl: `${INFERERA_ROOT_URL}/v1`,
  };
}

export function resolveAIHubMixOpenAIConfig() {
  return {
    apiKey: readRequiredEnv("AIHUBMIX_API_KEY"),
    openAIBaseUrl: AIHUBMIX_OPENAI_BASE_URL,
  };
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

export function resolveAIHubMixAnthropicConfig() {
  return {
    apiKey: readRequiredEnv("AIHUBMIX_API_KEY"),
    baseUrl: AIHUBMIX_ROOT_URL,
  };
}

export function resolveInfereraAnthropicConfig() {
  return {
    apiKey: readRequiredEnv("AIHUBMIX_API_KEY"),
    baseUrl: INFERERA_ROOT_URL,
  };
}

export function resolveGeminiProviderConfig() {
  return { apiKey: readRequiredEnv("GEMINI_API_KEY") };
}

export function resolveQwenAudioConfig() {
  return {
    apiKey: readRequiredEnv("DASHSCOPE_API_KEY"),
    baseUrl: QWEN_AUDIO_BASE_URL,
  };
}

export function resolveQwenImageConfig() {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("千问图片服务尚未配置，请在 Zeabur 环境变量中设置 DASHSCOPE_API_KEY");
  }
  return {
    apiKey,
    endpoint: QWEN_IMAGE_GENERATION_URL,
  };
}

export function resolveHappyHorseVideoConfig() {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("HappyHorse 视频服务尚未配置，请在 Zeabur 环境变量中设置 DASHSCOPE_API_KEY");
  }
  return {
    apiKey,
    createEndpoint: HAPPYHORSE_VIDEO_GENERATION_URL,
    tasksEndpoint: HAPPYHORSE_TASKS_URL,
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
