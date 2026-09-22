const QWEN_WORKSPACE_ROOT_URL = "https://ws-2t7yj3g991jc5yo6.ap-southeast-1.maas.aliyuncs.com";
const QWEN_AUDIO_BASE_URL = `${QWEN_WORKSPACE_ROOT_URL}/api/v1`;
const QWEN_IMAGE_GENERATION_URL = `${QWEN_WORKSPACE_ROOT_URL}/api/v1/services/aigc/multimodal-generation/generation`;
const MINIMAX_AUDIO_GENERATION_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
const AI_MEDIAKIT_BASE_URL = "https://mediakit.cn-beijing.volces.com";
const DOUBAO_AUDIO_GENERATION_URL = "https://openspeech.bytedance.com/api/v3/tts/create";
const MICU_IMAGE_BASE_URL = "https://www.micuapi.ai/v1/images";

function readRequiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
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

export function resolveMicuImageConfig() {
  const apiKey = process.env.MICU_OPENAI_IMAGE_API_KEY?.trim();
  if (!apiKey) {
    throw Object.assign(new Error("Micu 图片服务尚未配置，请联系管理员"), {
      status: 503,
      code: "SERVICE_NOT_CONFIGURED",
      requestId: undefined,
      upstreamRejected: false,
    });
  }
  return {
    apiKey,
    endpoint: `${MICU_IMAGE_BASE_URL}/generations`,
    editEndpoint: `${MICU_IMAGE_BASE_URL}/edits`,
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
