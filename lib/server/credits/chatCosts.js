import { calculateChatCost } from "@/lib/server/credits/pricing";

function usageTokenCount(usage, ...keys) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return undefined;
  const key = keys.find((candidate) => candidate && Object.hasOwn(usage, candidate));
  if (!key) return undefined;
  const value = usage[key];
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("模型返回的 token 用量不完整");
  }
  return value;
}

export function calculateAccumulatedCosts({ model, usageRecords, settings, requestFingerprint }) {
  if (!Array.isArray(usageRecords) || usageRecords.length === 0) {
    throw new Error("模型用量记录不完整");
  }
  const records = usageRecords.filter((record) => (
    record?.usage
    && typeof record.usage === "object"
    && !Array.isArray(record.usage)
  ));
  if (records.length !== usageRecords.length) throw new Error("模型用量记录不完整");

  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let cacheWriteTokens = 0;
  let chatCostUsd = 0;
  for (const record of records) {
    const input = usageTokenCount(record.usage, "input_tokens", "prompt_tokens");
    const output = usageTokenCount(record.usage, "output_tokens", "completion_tokens");
    if (input === undefined || output === undefined) throw new Error("模型返回的 token 用量不完整");
    inputTokens += input;
    outputTokens += output;
    const tokenDetails = record.usage.input_tokens_details ?? record.usage.prompt_tokens_details;
    if (tokenDetails !== undefined && (
      !tokenDetails
      || typeof tokenDetails !== "object"
      || Array.isArray(tokenDetails)
    )) throw new Error("模型返回的 token 用量不完整");
    const recordCachedInputTokens = usageTokenCount(tokenDetails, "cached_tokens")
      ?? usageTokenCount(record.usage, "cached_tokens")
      ?? 0;
    const recordCacheWriteTokens = usageTokenCount(
      record.usage,
      "cache_write_tokens",
      "cache_write_input_tokens",
    ) ?? usageTokenCount(tokenDetails, "cache_write_tokens") ?? 0;
    cachedInputTokens += recordCachedInputTokens;
    cacheWriteTokens += recordCacheWriteTokens;
    chatCostUsd += calculateChatCost({
      model,
      inputTokens: input,
      outputTokens: output,
      cachedInputTokens: recordCachedInputTokens,
      cacheWriteTokens: recordCacheWriteTokens,
    }, settings).costUsd;
  }

  return {
    actualCostCny: chatCostUsd * settings.usdToCny,
    actualCostUsd: chatCostUsd,
    usage: {
      model,
      requestFingerprint,
      inputTokens,
      cachedInputTokens,
      cacheWriteTokens,
      outputTokens,
      usageRecords,
    },
  };
}
