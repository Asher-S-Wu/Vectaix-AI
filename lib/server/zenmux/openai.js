import OpenAI from "openai";
import { resolveZenMuxProviderConfig } from "@/lib/modelRoutes";
import { DEFAULT_MODEL } from "@/lib/shared/models";

const REASONING_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);

export function createZenMuxOpenAIClient() {
  const { openAIBaseUrl, apiKey } = resolveZenMuxProviderConfig();
  return new OpenAI({
    apiKey,
    baseURL: openAIBaseUrl,
  });
}

function normalizeReasoningEffort(value, defaultValue = "high") {
  const effort = typeof value === "string" ? value.trim() : "";
  return REASONING_EFFORTS.has(effort) ? effort : defaultValue;
}

export function buildChatCompletionsRequest({
  model = DEFAULT_MODEL,
  messages,
  system,
  prompt,
  stream = false,
  reasoningEffort = "high",
  tools,
  toolChoice,
  extra = {},
} = {}) {
  const effort = normalizeReasoningEffort(reasoningEffort);
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
  reasoningEffort = "high",
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
