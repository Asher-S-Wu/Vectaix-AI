import { GoogleGenAI } from "@google/genai";
import {
  GEMINI_PRO_MODEL,
  isClaudeOpusModel,
} from "@/lib/shared/models";
import {
  resolveGeminiProviderConfig,
  resolveOpusProviderConfig,
  resolveDeepSeekProviderConfig,
  resolveSeedProviderConfig,
} from "@/lib/modelRoutes";

export { resolveDeepSeekProviderConfig, resolveSeedProviderConfig };

export function isClaudeModel(model) {
  return isClaudeOpusModel(model);
}

export function isAnthropicCompatibleProvider(provider) {
  return provider === "claude";
}

export function resolveAnthropicApiModel(model) {
  return model;
}

export async function resolveAnthropicProviderConfig(model) {
  return resolveOpusProviderConfig(model);
}

export function resolveGeminiApiModel(model) {
  // 当前只有一个 Gemini 模型，直接返回
  return GEMINI_PRO_MODEL;
}

export async function createGeminiClient() {
  const providerConfig = resolveGeminiProviderConfig();
  if (!providerConfig?.apiKey) {
    throw new Error("Gemini provider apiKey is not set");
  }
  if (providerConfig?.baseUrl) {
    return new GoogleGenAI({
      apiKey: providerConfig.apiKey,
      httpOptions: {
        baseUrl: providerConfig.baseUrl,
      },
    });
  }
  return new GoogleGenAI({ apiKey: providerConfig.apiKey });
}
