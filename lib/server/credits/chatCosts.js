import { calculateChatCost } from "@/lib/server/credits/pricing";

function usageTokenCount(usage, key) {
  const value = usage?.[key];
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
  let chatCostUsd = 0;
  for (const record of records) {
    const input = usageTokenCount(record.usage, "input_tokens");
    const output = usageTokenCount(record.usage, "output_tokens");
    inputTokens += input;
    outputTokens += output;
    const recordCachedInputTokens = usageTokenCount(record.usage.input_tokens_details, "cached_tokens");
    cachedInputTokens += recordCachedInputTokens;
    chatCostUsd += calculateChatCost({
      model,
      created: record.created,
      inputTokens: input,
      outputTokens: output,
      cachedInputTokens: recordCachedInputTokens,
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
      outputTokens,
      usageRecords,
    },
  };
}
