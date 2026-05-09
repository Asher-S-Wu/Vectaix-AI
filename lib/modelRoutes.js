import {
  CLAUDE_OPUS_MODEL,
  OPENAI_PRIMARY_MODEL,
} from "@/lib/shared/models";

const ZENMUX_API_KEY = process.env.ZENMUX_API_KEY;
const ZENMUX_OPENAI_BASE_URL = "https://zenmux.ai/api/v1";
const ARK_API_KEY = process.env.ARK_API_KEY;
const ARK_OPENAI_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_OPENAI_BASE_URL = "https://api.deepseek.com";
const DRAGON_CODE_BASE_URL = "https://dragoncode.codes";
const DRAGON_CODE_GPT_API_KEY = process.env.DRAGON_CODE_GPT_API_KEY;
const DRAGON_CODE_CLAUDE_API_KEY = process.env.DRAGON_CODE_CLAUDE_API_KEY;
const DRAGON_CODE_GEMINI_API_KEY = process.env.DRAGON_CODE_GEMINI_API_KEY;
const DRAGON_CODE_IMAGE_API_KEY = process.env.DRAGON_CODE_IMAGE_API_KEY;
const DRAGON_CODE_IMAGE_BASE_URL = "https://dragoncode.codes/gpt-image/v1";

export function resolveOpenAIProviderConfig(model) {
  if (model === OPENAI_PRIMARY_MODEL) {
    if (!DRAGON_CODE_GPT_API_KEY) {
      throw new Error("DRAGON_CODE_GPT_API_KEY is not set");
    }
    return {
      baseUrl: DRAGON_CODE_BASE_URL,
      apiKey: DRAGON_CODE_GPT_API_KEY,
    };
  }

  if (!ZENMUX_API_KEY) {
    throw new Error("ZENMUX_API_KEY is not set");
  }
  return {
    baseUrl: ZENMUX_OPENAI_BASE_URL,
    apiKey: ZENMUX_API_KEY,
  };
}

export function resolveOpusProviderConfig(model = CLAUDE_OPUS_MODEL) {
  if (!DRAGON_CODE_CLAUDE_API_KEY) {
    throw new Error("DRAGON_CODE_CLAUDE_API_KEY is not set");
  }
  return {
    baseUrl: DRAGON_CODE_BASE_URL,
    apiKey: DRAGON_CODE_CLAUDE_API_KEY,
  };
}

export function resolveGeminiProviderConfig() {
  if (!DRAGON_CODE_GEMINI_API_KEY) {
    throw new Error("DRAGON_CODE_GEMINI_API_KEY is not set");
  }
  return {
    baseUrl: DRAGON_CODE_BASE_URL,
    apiKey: DRAGON_CODE_GEMINI_API_KEY,
  };
}

export function resolveDeepSeekProviderConfig() {
  if (!DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY is not set");
  }
  return {
    baseUrl: DEEPSEEK_OPENAI_BASE_URL,
    apiKey: DEEPSEEK_API_KEY,
  };
}

export function resolveSeedProviderConfig() {
  if (!ARK_API_KEY) {
    throw new Error("ARK_API_KEY is not set");
  }
  return {
    baseUrl: ARK_OPENAI_BASE_URL,
    apiKey: ARK_API_KEY,
  };
}

export function resolveImageGenProviderConfig() {
  if (!DRAGON_CODE_IMAGE_API_KEY) {
    throw new Error("DRAGON_CODE_IMAGE_API_KEY is not set");
  }
  return {
    baseUrl: DRAGON_CODE_IMAGE_BASE_URL,
    apiKey: DRAGON_CODE_IMAGE_API_KEY,
  };
}

export function resolveCouncilProviderRoutes() {
  return {
    openai: resolveOpenAIProviderConfig(OPENAI_PRIMARY_MODEL),
    opus: resolveOpusProviderConfig(CLAUDE_OPUS_MODEL),
    gemini: resolveGeminiProviderConfig(),
  };
}
