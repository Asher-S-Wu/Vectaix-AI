import OpenAI from "openai";
import { resolveZenMuxProviderConfig } from "@/lib/modelRoutes";
import {
  DEFAULT_MODEL,
  getDefaultMaxTokensForModel,
  getMaxReasoningEffortForModel,
} from "@/lib/shared/models";

const REASONING_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);

export function createZenMuxOpenAIClient() {
  const { openAIBaseUrl, apiKey } = resolveZenMuxProviderConfig();
  return new OpenAI({
    apiKey,
    baseURL: openAIBaseUrl,
  });
}

function resolveReasoningEffort(model, reasoningEffort) {
  const effort = typeof reasoningEffort === "string" ? reasoningEffort.trim() : "";
  if (REASONING_EFFORTS.has(effort)) return effort;
  return getMaxReasoningEffortForModel(model);
}

function resolveMaxCompletionTokens(model, maxTokens) {
  const parsed = Number.parseInt(maxTokens, 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return getDefaultMaxTokensForModel(model);
}

export function buildChatCompletionsRequest({
  model = DEFAULT_MODEL,
  messages,
  system,
  prompt,
  stream = false,
  reasoningEffort,
  maxTokens,
  tools,
  toolChoice,
  extra = {},
} = {}) {
  const effort = resolveReasoningEffort(model, reasoningEffort);
  const maxCompletionTokens = resolveMaxCompletionTokens(model, maxTokens);
  const requestMessages = [];

  if (typeof system === "string" && system.trim()) {
    requestMessages.push({ role: "system", content: system.trim() });
  }

  if (Array.isArray(messages)) {
    requestMessages.push(...messages);
  } else {
    requestMessages.push({ role: "user", content: String(prompt ?? "") });
  }

  const request = {
    model,
    messages: requestMessages,
    max_completion_tokens: maxCompletionTokens,
    reasoning_effort: effort,
    reasoning: {
      enabled: true,
      effort,
      exclude: false,
    },
    ...extra,
  };

  if (stream) {
    request.stream = true;
    request.stream_options = { include_usage: true };
  }
  if (Array.isArray(tools) && tools.length > 0) {
    request.tools = tools;
  }
  if (toolChoice) {
    request.tool_choice = toolChoice;
  }

  return request;
}

export async function requestZenMuxChatCompletionResponse({
  system,
  prompt,
  messages,
  model = DEFAULT_MODEL,
  signal,
  reasoningEffort,
  maxTokens,
  tools,
  toolChoice,
  extra = {},
} = {}) {
  const client = createZenMuxOpenAIClient();

  return client.chat.completions.create(
    buildChatCompletionsRequest({
      model,
      system,
      prompt,
      messages,
      stream: false,
      reasoningEffort,
      maxTokens,
      tools,
      toolChoice,
      extra,
    }),
    { signal }
  );
}

export async function requestZenMuxChatCompletion(input = {}) {
  const response = await requestZenMuxChatCompletionResponse(input);
  return getChatCompletionOutputText(response);
}

function getContentText(content) {
  if (typeof content === "string") return content;
  return Array.isArray(content) ? content
    .map((part) => {
      if (typeof part === "string") return part;
      if (typeof part?.text === "string") return part.text;
      return "";
    })
    .join("") : "";
}

export function getChatCompletionMessage(response) {
  return response?.choices?.[0]?.message || null;
}

export function getChatCompletionOutputText(response) {
  return getContentText(getChatCompletionMessage(response)?.content).trim();
}

export function getChatCompletionToolCalls(response) {
  const calls = getChatCompletionMessage(response)?.tool_calls;
  return Array.isArray(calls) ? calls : [];
}

export function getChatCompletionCompletedUsage(eventOrResponse) {
  return eventOrResponse?.usage && typeof eventOrResponse.usage === "object" ? eventOrResponse.usage : null;
}

export function getChatCompletionChunkDelta(chunk) {
  return chunk?.choices?.[0]?.delta || {};
}

export function getChatCompletionChunkThoughtDelta(chunk) {
  const delta = getChatCompletionChunkDelta(chunk);
  const reasoning = typeof delta?.reasoning === "string" ? delta.reasoning : "";
  const reasoningContent = typeof delta?.reasoning_content === "string" ? delta.reasoning_content : "";
  if (reasoning && reasoningContent && reasoning !== reasoningContent) {
    return `${reasoning}${reasoningContent}`;
  }
  return reasoningContent || reasoning;
}

export function normalizeOpenAIError(error) {
  if (error instanceof OpenAI.APIError) {
    const err = new Error(error.message || `模型请求失败（${error.status}）`);
    err.status = error.status;
    err.code = error.code;
    return err;
  }
  return error;
}
