import {
  SEED_MODEL_ID,
  SEED_REASONING_LEVELS,
} from "@/lib/shared/models";
import { fetchWithZenmuxRateLimit } from "@/lib/server/providers/zenmuxRateLimit";

const SEED_MAX_RETRIES = 2;
const SEED_MAX_OUTPUT_TOKENS = 32768;
const VALID_SEED_REASONING_LEVELS = new Set(SEED_REASONING_LEVELS);
const SEED_CONNECTION_ERROR_STATUS = 502;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractSeedTransportErrorCode(error) {
  if (typeof error?.code === "string" && error.code) return error.code;
  if (typeof error?.cause?.code === "string" && error.cause.code) return error.cause.code;
  if (typeof error?.cause?.cause?.code === "string" && error.cause.cause.code) {
    return error.cause.cause.code;
  }
  return "";
}

function normalizeSeedTransportError(error) {
  if (!error || typeof error?.status === "number" || error?.name === "AbortError") {
    return error;
  }

  const code = extractSeedTransportErrorCode(error).toUpperCase();
  const rawMessage = typeof error?.message === "string" ? error.message.trim() : "";
  const lowerMessage = rawMessage.toLowerCase();

  let message = "Seed 官方接口连接失败，请稍后重试";

  if (
    code === "ETIMEDOUT"
    || code === "ECONNABORTED"
    || code === "UND_ERR_CONNECT_TIMEOUT"
    || lowerMessage.includes("timeout")
    || lowerMessage.includes("timed out")
  ) {
    message = "Seed 官方接口连接超时，请稍后重试";
  } else if (
    code === "ENOTFOUND"
    || code === "EAI_AGAIN"
    || code === "ECONNREFUSED"
    || code === "ECONNRESET"
    || code === "EHOSTUNREACH"
    || code === "ENETUNREACH"
    || lowerMessage.includes("fetch failed")
    || lowerMessage.includes("network")
    || lowerMessage.includes("socket")
    || lowerMessage.includes("connect")
    || lowerMessage.includes("tls")
  ) {
    message = "Seed 官方接口连接失败，请稍后重试";
  } else if (rawMessage) {
    message = `Seed 官方接口请求异常：${rawMessage}`;
  }

  const normalizedError = new Error(message);
  normalizedError.status = SEED_CONNECTION_ERROR_STATUS;
  if (code) normalizedError.code = code;
  normalizedError.cause = error;
  return normalizedError;
}

export function createSeedUpstreamSignal(req) {
  return req?.signal;
}

export function normalizeSeedChunkText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item.text === "string") return item.text;
        if (item && typeof item.content === "string") return item.content;
        return "";
      })
      .join("");
  }
  if (value && typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (typeof value.content === "string") return value.content;
  }
  return "";
}

function sanitizeJsonValue(value, depth = 0) {
  if (depth > 6) return undefined;
  if (typeof value === "string") return value.slice(0, 12000);
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map((item) => sanitizeJsonValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (!value || typeof value !== "object") return undefined;
  const next = {};
  for (const [key, item] of Object.entries(value).slice(0, 80)) {
    const sanitized = sanitizeJsonValue(item, depth + 1);
    if (sanitized !== undefined) next[key] = sanitized;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

export function normalizeSeedOutputItems(output) {
  if (!Array.isArray(output)) return [];
  return output
    .map((item) => sanitizeJsonValue(item))
    .filter((item) => item && typeof item === "object");
}

export function extractSeedResponseReasoning(payload) {
  const outputs = Array.isArray(payload?.output) ? payload.output : [];
  return outputs
    .filter((item) => item?.type === "reasoning")
    .flatMap((item) => {
      const summary = Array.isArray(item?.summary) ? item.summary : [];
      if (summary.length > 0) return summary;
      const content = Array.isArray(item?.content) ? item.content : [];
      return content;
    })
    .map((item) => normalizeSeedChunkText(item?.text ?? item))
    .join("")
    .trim();
}

export function extractSeedFunctionCalls(payload) {
  const outputs = Array.isArray(payload?.output) ? payload.output : [];
  return outputs
    .filter((item) => item?.type === "function_call" && typeof item?.name === "string" && item.name && typeof item?.call_id === "string" && item.call_id)
    .map((item) => ({
      id: typeof item?.id === "string" ? item.id : "",
      call_id: item.call_id,
      name: item.name,
      arguments: typeof item?.arguments === "string" ? item.arguments : JSON.stringify(item?.arguments || {}),
    }));
}

export function buildSeedRequestBody({
  model = SEED_MODEL_ID,
  input,
  instructions,
  maxTokens,
  thinkingLevel,
  stream = true,
  temperature = 1,
  topP = 0.95,
}) {
  const normalizedThinkingLevel = typeof thinkingLevel === "string"
    ? thinkingLevel.trim().toLowerCase()
    : "";

  const requestBody = {
    model,
    stream,
    input,
    instructions,
    temperature,
    top_p: topP,
  };

  if (Number.isFinite(maxTokens) && maxTokens > 0) {
    requestBody.max_output_tokens = Math.min(maxTokens, SEED_MAX_OUTPUT_TOKENS);
  }

  if (normalizedThinkingLevel === "minimal") {
    requestBody.thinking = { type: "disabled" };
  } else {
    if (!VALID_SEED_REASONING_LEVELS.has(normalizedThinkingLevel)) {
      throw new Error("thinkingLevel invalid");
    }
    requestBody.thinking = { type: "enabled" };
    requestBody.reasoning = { effort: normalizedThinkingLevel };
  }

  return requestBody;
}

export function buildSeedJsonRequestBody({
  model = SEED_MODEL_ID,
  input,
  instructions,
  maxTokens,
  temperature = 0.2,
  thinkingLevel,
}) {
  const normalizedThinkingLevel = typeof thinkingLevel === "string"
    ? thinkingLevel.trim().toLowerCase()
    : "";

  if (!normalizedThinkingLevel) {
    throw new Error("thinkingLevel required");
  }

  const requestBody = {
    model,
    stream: false,
    input,
    instructions,
    temperature,
    top_p: 0.95,
  };

  if (Number.isFinite(maxTokens) && maxTokens > 0) {
    requestBody.max_output_tokens = Math.min(maxTokens, SEED_MAX_OUTPUT_TOKENS);
  }

  if (normalizedThinkingLevel === "minimal") {
    requestBody.thinking = { type: "disabled" };
    return requestBody;
  }

  if (!VALID_SEED_REASONING_LEVELS.has(normalizedThinkingLevel)) {
    throw new Error("thinkingLevel invalid");
  }

  requestBody.thinking = { type: "enabled" };
  requestBody.reasoning = { effort: normalizedThinkingLevel };
  return requestBody;
}

export async function requestSeedResponses({
  apiKey,
  baseUrl,
  requestBody,
  req,
}) {
  const url = `${baseUrl}/responses`;

  for (let attempt = 0; attempt < SEED_MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetchWithZenmuxRateLimit(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: createSeedUpstreamSignal(req),
      }, {
        label: `ark:seed:${requestBody?.model || "seed"}`,
      });

      if (response.ok) {
        return response;
      }

      const errorText = await response.text();
      const shouldRetry = response.status >= 500 && attempt < SEED_MAX_RETRIES - 1;
      if (shouldRetry) {
        await sleep(800 * (attempt + 1));
        continue;
      }

      const error = new Error(`Seed 官方接口请求失败（${response.status}）：${errorText}`);
      error.status = response.status;
      throw error;
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      const normalizedError = normalizeSeedTransportError(error);
      if (attempt >= SEED_MAX_RETRIES - 1) throw normalizedError;
      await sleep(800 * (attempt + 1));
    }
  }

  throw new Error("Seed 官方接口请求失败");
}

export function extractSeedResponseText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const outputs = Array.isArray(payload?.output) ? payload.output : [];

  // Responses API 格式
  const messageText = outputs
    .filter((item) => item?.type === "message")
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .map((item) => normalizeSeedChunkText(item?.text ?? item))
    .join("")
    .trim();
  if (messageText) return messageText;

  // Chat Completions 格式（accumulated output）
  return outputs
    .filter((item) => item?.type === "text")
    .map((item) => normalizeSeedChunkText(item?.text ?? item))
    .join("")
    .trim();
}

export async function requestSeedJson({
  apiKey,
  baseUrl,
  requestBody,
  req,
}) {
  const response = await requestSeedResponses({ apiKey, baseUrl, requestBody, req });
  const payload = await response.json();
  return {
    payload,
    text: extractSeedResponseText(payload),
  };
}
