import OpenAI from "openai";
import { resolveOpenRouterProviderConfig } from "@/lib/modelRoutes";
import { FUSION_SYNTHESIS_MODEL } from "@/lib/shared/models";

function createOpenRouterClient() {
  const config = resolveOpenRouterProviderConfig();
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.openAIBaseUrl,
    defaultHeaders: config.defaultHeaders,
  });
}

export async function requestOpenRouterChatCompletionResponse({
  system,
  prompt,
  messages,
  model = FUSION_SYNTHESIS_MODEL,
  signal,
  reasoningEffort = "max",
  maxTokens = 128000,
  forceFusion = false,
  tools,
} = {}) {
  const requestMessages = [];
  if (typeof system === "string" && system.trim()) requestMessages.push({ role: "system", content: system.trim() });
  if (Array.isArray(messages)) requestMessages.push(...messages);
  else requestMessages.push({ role: "user", content: String(prompt || "") });
  return createOpenRouterClient().chat.completions.create({
    model,
    messages: requestMessages,
    max_completion_tokens: maxTokens,
    reasoning: { effort: reasoningEffort },
    plugins: [{
      id: "fusion",
      preset: "general-high",
      max_tool_calls: 16,
    }],
    ...(forceFusion ? { tool_choice: "required" } : {}),
    ...(Array.isArray(tools) && tools.length ? { tools } : {}),
  }, { signal });
}

function contentText(content) {
  if (typeof content === "string") return content;
  return Array.isArray(content) ? content.map((part) => part?.text || "").join("") : "";
}

export function getChatCompletionOutputText(response) {
  return contentText(response?.choices?.[0]?.message?.content).trim();
}

export function getChatCompletionAnnotations(response) {
  const annotations = response?.choices?.[0]?.message?.annotations;
  if (!Array.isArray(annotations)) return [];
  const seen = new Set();
  return annotations.map((annotation) => annotation?.type === "url_citation" ? annotation.url_citation : null)
    .filter((citation) => citation?.url && !seen.has(citation.url) && seen.add(citation.url))
    .map((citation) => ({ url: citation.url, title: citation.title || citation.url }));
}
