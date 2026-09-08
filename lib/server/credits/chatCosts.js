import { calculateChatCost, pointsFromUsd } from "@/lib/server/credits/pricing";

function usageTokenCount(usage, primary, alternate) {
  const value = usage?.[primary] ?? usage?.[alternate];
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function calculateAccumulatedCosts({ model, provider, usageRecords, settings, requestFingerprint }) {
  const records = usageRecords.filter((record) => record?.usage && typeof record.usage === "object");
  if (records.length !== usageRecords.length) throw new Error("模型用量记录不完整");

  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let cacheWriteTokens = 0;
  let openRouterUsageCost = provider === "qwen" ? null : 0;
  let chatCostUsd = 0;
  for (const record of records) {
    const input = usageTokenCount(record.usage, "input_tokens", "prompt_tokens");
    const output = usageTokenCount(record.usage, "output_tokens", "completion_tokens");
    if (input !== null) inputTokens += input;
    if (output !== null) outputTokens += output;
    const tokenDetails = record.usage?.input_tokens_details || record.usage?.prompt_tokens_details;
    const recordCachedInputTokens = usageTokenCount(tokenDetails, "cached_tokens", "cached_tokens") ?? 0;
    const recordCacheWriteTokens = usageTokenCount(
      record.usage,
      "cache_write_tokens",
      "cache_write_input_tokens",
    ) ?? usageTokenCount(tokenDetails, "cache_write_tokens", "cache_write_tokens") ?? 0;
    cachedInputTokens += recordCachedInputTokens;
    cacheWriteTokens += recordCacheWriteTokens;
    if (provider === "qwen") {
      if (input === null || output === null) throw new Error("模型返回的 token 用量不完整");
      chatCostUsd += calculateChatCost({
        model,
        inputTokens: input,
        outputTokens: output,
        cachedInputTokens: recordCachedInputTokens,
        cacheWriteTokens: recordCacheWriteTokens,
      }, settings).costUsd;
    } else {
      const rawCost = record.usage.cost;
      const numericCost = typeof rawCost === "string" ? Number(rawCost) : rawCost;
      if (
        (typeof rawCost === "string" && !rawCost.trim())
        || !Number.isFinite(numericCost)
        || numericCost < 0
      ) {
        throw new Error("OpenRouter 未返回本轮 usage.cost");
      }
      openRouterUsageCost += numericCost;
      chatCostUsd += numericCost;
    }
  }

  return {
    chargedPoints: pointsFromUsd(chatCostUsd, settings),
    actualCostCny: chatCostUsd * settings.usdToCny,
    actualCostUsd: chatCostUsd,
    usage: {
      model,
      requestFingerprint,
      inputTokens,
      cachedInputTokens,
      cacheWriteTokens,
      outputTokens,
      ...(openRouterUsageCost === null ? {} : { openRouterUsageCost }),
      usageRecords,
    },
  };
}

