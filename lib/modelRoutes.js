const INFERERA_ROOT_URL = "https://api.inferera.com";
const AIHUBMIX_ROOT_URL = "https://aihubmix.com";
const AIHUBMIX_OPENAI_BASE_URL = `${AIHUBMIX_ROOT_URL}/v1`;

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

export function resolveInfereraMediaConfig() {
  return {
    apiKey: readRequiredEnv("AIHUBMIX_API_KEY"),
    baseUrl: `${INFERERA_ROOT_URL}/v1`,
  };
}

export function resolveGeminiProviderConfig() {
  return { apiKey: readRequiredEnv("GEMINI_API_KEY") };
}
