const ZENMUX_OPENAI_BASE_URL = "https://zenmux.ai/api/v1";
const OPENROUTER_OPENAI_BASE_URL = "https://openrouter.ai/api/v1";
const ARK_OPENAI_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const ARK_VIDEO_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks";

function readRequiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

export function resolveZenMuxProviderConfig() {
  const apiKey = readRequiredEnv("ZENMUX_API_KEY");

  return {
    apiKey,
    openAIBaseUrl: ZENMUX_OPENAI_BASE_URL,
  };
}

export function resolveOpenRouterProviderConfig() {
  const apiKey = readRequiredEnv("OPENROUTER_API_KEY");

  return {
    apiKey,
    openAIBaseUrl: OPENROUTER_OPENAI_BASE_URL,
    defaultHeaders: {
      "HTTP-Referer": "https://vectaix.ai",
      "X-OpenRouter-Title": "Vectaix AI",
    },
  };
}

export function resolveArkChatProviderConfig() {
  const apiKey = readRequiredEnv("ARK_API_KEY");

  return {
    apiKey,
    openAIBaseUrl: ARK_OPENAI_BASE_URL,
  };
}

export const resolveSeedProviderConfig = resolveArkChatProviderConfig;

export function resolveArkVideoProviderConfig() {
  const apiKey = readRequiredEnv("ARK_API_KEY");

  return {
    apiKey,
    baseUrl: ARK_VIDEO_BASE_URL,
  };
}
