const INFERERA_ROOT_URL = "https://api.inferera.com";
const OPENROUTER_OPENAI_BASE_URL = "https://openrouter.ai/api/v1";

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

export function resolveInfereraAnthropicConfig() {
  return {
    apiKey: readRequiredEnv("AIHUBMIX_API_KEY"),
    baseUrl: INFERERA_ROOT_URL,
  };
}

export function resolveInfereraMediaConfig() {
  return {
    apiKey: readRequiredEnv("AIHUBMIX_API_KEY"),
    baseUrl: `${INFERERA_ROOT_URL}/v1`,
  };
}

export function resolveGeminiProviderConfig() {
  return { apiKey: readRequiredEnv("GEMINI_API_KEY") };
}

export function resolveOpenRouterProviderConfig() {
  return {
    apiKey: readRequiredEnv("OPENROUTER_API_KEY"),
    openAIBaseUrl: OPENROUTER_OPENAI_BASE_URL,
    defaultHeaders: {
      "HTTP-Referer": "https://vectaix.ai",
      "X-OpenRouter-Title": "Vectaix AI",
    },
  };
}
