const ZENMUX_OPENAI_BASE_URL = "https://zenmux.ai/api/v1";

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
