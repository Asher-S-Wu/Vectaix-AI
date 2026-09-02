import { POINTS_PER_CNY } from "./constants";
import { invalidCreditArgument } from "./errors";

function assertAmount(value, name) {
  if (!Number.isFinite(value) || value < 0) {
    throw invalidCreditArgument(`${name} 必须是非负有限数字`);
  }
  return value;
}

function assertCount(value, name) {
  assertAmount(value, name);
  if (!Number.isSafeInteger(value)) {
    throw invalidCreditArgument(`${name} 必须是非负整数`);
  }
  return value;
}

function requireSettings(settings) {
  if (!settings || typeof settings !== "object") {
    throw invalidCreditArgument("缺少完整计费设置");
  }
  assertAmount(settings.costMultiplier, "costMultiplier");
  assertAmount(settings.usdToCny, "usdToCny");
  if (settings.costMultiplier === 0 || settings.usdToCny === 0) {
    throw invalidCreditArgument("costMultiplier 和 usdToCny 必须大于 0");
  }
  if (!settings.rates || typeof settings.rates !== "object") {
    throw invalidCreditArgument("缺少完整费率表");
  }
  return settings;
}

function ceilPointsWithUlpTolerance(rawPoints) {
  assertAmount(rawPoints, "rawPoints");
  const nearestInteger = Math.round(rawPoints);
  const oneUlpTolerance = Number.EPSILON * Math.max(1, Math.abs(rawPoints));
  const normalized = Math.abs(rawPoints - nearestInteger) <= oneUlpTolerance
    ? nearestInteger
    : rawPoints;
  const points = Math.ceil(normalized);
  if (!Number.isSafeInteger(points)) {
    throw invalidCreditArgument("换算后的积分超出安全整数范围");
  }
  return points;
}

function resultFromCny(cny, settings, details = {}) {
  const amountCny = assertAmount(cny, "costCny");
  return {
    points: pointsFromCny(amountCny, settings),
    costCny: amountCny,
    costUsd: null,
    ...details,
  };
}

function resultFromUsd(usd, settings, details = {}) {
  const amountUsd = assertAmount(usd, "costUsd");
  return {
    points: pointsFromUsd(amountUsd, settings),
    costCny: amountUsd * settings.usdToCny,
    costUsd: amountUsd,
    ...details,
  };
}

export function pointsFromCny(cny, settings) {
  const resolved = requireSettings(settings);
  assertAmount(cny, "cny");
  return ceilPointsWithUlpTolerance(cny * resolved.costMultiplier * POINTS_PER_CNY);
}

export function pointsFromUsd(usd, settings) {
  const resolved = requireSettings(settings);
  assertAmount(usd, "usd");
  return pointsFromCny(usd * resolved.usdToCny, resolved);
}

export function getChatReservationPoints(settings) {
  const resolved = requireSettings(settings);
  return assertCount(resolved.chatReservationLimit, "chatReservationLimit");
}

export function createPricingSnapshot(settings) {
  const resolved = requireSettings(settings);
  if (!Number.isInteger(resolved.version) || resolved.version < 1) {
    throw invalidCreditArgument("计费设置版本无效");
  }
  if (typeof resolved.pricingDate !== "string" || !resolved.pricingDate.trim()) {
    throw invalidCreditArgument("计费日期无效");
  }
  return structuredClone({
    version: resolved.version,
    pricingDate: resolved.pricingDate,
    costMultiplier: resolved.costMultiplier,
    usdToCny: resolved.usdToCny,
    rates: resolved.rates,
  });
}

export function calculateChatCost({
  model,
  inputTokens = 0,
  cachedInputTokens = 0,
  cacheWriteTokens = 0,
  outputTokens = 0,
  openRouterUsageCost,
  openRouterUsage,
} = {}, settings) {
  const resolved = requireSettings(settings);
  if (typeof model !== "string" || !model.trim()) {
    throw invalidCreditArgument("model 必须是非空字符串");
  }
  const rate = resolved.rates.chat?.[model];
  if (!rate) throw invalidCreditArgument(`没有模型 ${model} 的计费费率`);
  const usageCost = openRouterUsageCost ?? openRouterUsage?.cost;
  if (usageCost !== undefined && usageCost !== null) {
    if (typeof usageCost === "string" && !usageCost.trim()) {
      throw invalidCreditArgument("OpenRouter usage.cost 不能为空字符串");
    }
    const actual = typeof usageCost === "string" ? Number(usageCost) : usageCost;
    return resultFromUsd(assertAmount(actual, "OpenRouter usage.cost"), resolved, {
      source: "openrouter_usage_cost",
      model,
    });
  }
  assertCount(inputTokens, "inputTokens");
  assertCount(cachedInputTokens, "cachedInputTokens");
  assertCount(cacheWriteTokens, "cacheWriteTokens");
  assertCount(outputTokens, "outputTokens");
  if (cachedInputTokens + cacheWriteTokens > inputTokens) {
    throw invalidCreditArgument("缓存输入 token 不能超过总输入 token");
  }
  assertAmount(rate.inputPerMillion, "inputPerMillion");
  assertAmount(rate.outputPerMillion, "outputPerMillion");
  const uncachedInputTokens = inputTokens - cachedInputTokens - cacheWriteTokens;
  const cachedRate = rate.cachedInputPerMillion ?? rate.inputPerMillion;
  const cacheWriteRate = rate.cacheWritePerMillion ?? rate.inputPerMillion;
  let contextMultiplier = 1;
  let inputMultiplier = 1;
  let outputMultiplier = 1;
  if (rate.longContextThreshold !== undefined && inputTokens > rate.longContextThreshold) {
    if (rate.longInputMultiplier !== undefined || rate.longOutputMultiplier !== undefined) {
      inputMultiplier = assertAmount(rate.longInputMultiplier, "longInputMultiplier");
      outputMultiplier = assertAmount(rate.longOutputMultiplier, "longOutputMultiplier");
    } else {
      contextMultiplier = assertAmount(rate.longContextMultiplier, "longContextMultiplier");
      inputMultiplier = contextMultiplier;
      outputMultiplier = contextMultiplier;
    }
  }
  const costUsd = (
    (uncachedInputTokens * rate.inputPerMillion
      + cachedInputTokens * cachedRate
      + cacheWriteTokens * cacheWriteRate) * inputMultiplier
    + outputTokens * rate.outputPerMillion * outputMultiplier
  ) / 1_000_000;
  return resultFromUsd(costUsd, resolved, {
    source: "token_usage",
    model,
    inputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    outputTokens,
    contextMultiplier,
    inputMultiplier,
    outputMultiplier,
  });
}

export function calculateOpenRouterUsageCost(usage, settings) {
  if (!usage || typeof usage !== "object") {
    throw invalidCreditArgument("OpenRouter usage 必须是对象");
  }
  if (typeof usage.cost === "string" && !usage.cost.trim()) {
    throw invalidCreditArgument("OpenRouter usage.cost 不能为空字符串");
  }
  const actual = typeof usage.cost === "string" ? Number(usage.cost) : usage.cost;
  return resultFromUsd(assertAmount(actual, "OpenRouter usage.cost"), requireSettings(settings), {
    source: "openrouter_usage_cost",
  });
}

export function estimateChatCost(input, settings) {
  return calculateChatCost(input, settings);
}

export function calculateExaCost({ searchRequests = 0, contentRequests = 0 } = {}, settings) {
  const resolved = requireSettings(settings);
  assertCount(searchRequests, "searchRequests");
  assertCount(contentRequests, "contentRequests");
  const rate = resolved.rates.exa;
  if (!rate) throw invalidCreditArgument("缺少 Exa 费率");
  const costUsd = searchRequests * rate.search20Usd + contentRequests * rate.contentsUsd;
  return resultFromUsd(costUsd, resolved, { searchRequests, contentRequests });
}

export function calculateQwenImageCost({ resolution, inputImageCount = 0 } = {}, settings) {
  const resolved = requireSettings(settings);
  assertCount(inputImageCount, "inputImageCount");
  const rate = resolved.rates.qwenImage;
  const outputCny = rate?.outputCny?.[resolution];
  if (!Number.isFinite(outputCny)) {
    throw invalidCreditArgument("resolution 只能是 1K 或 2K");
  }
  const costCny = outputCny + inputImageCount * rate.inputImageCny;
  return resultFromCny(costCny, resolved, { resolution, inputImageCount });
}

export function calculateHappyHorseVideoCost({
  mode = "generation",
  resolution,
  billableSeconds,
} = {}, settings) {
  const resolved = requireSettings(settings);
  assertAmount(billableSeconds, "billableSeconds");
  const rates = resolved.rates.happyHorse;
  const table = mode === "generation"
    ? rates?.generationCnyPerSecond
    : mode === "edit"
      ? rates?.editCnyPerSecond
      : null;
  const rate = table?.[String(resolution)];
  if (!Number.isFinite(rate)) {
    throw invalidCreditArgument("HappyHorse 模式或分辨率没有对应费率");
  }
  return resultFromCny(rate * billableSeconds, resolved, {
    mode,
    resolution: String(resolution),
    billableSeconds,
  });
}

export function calculateQwenTtsCost({ characters } = {}, settings) {
  const resolved = requireSettings(settings);
  assertCount(characters, "characters");
  const rate = resolved.rates.qwenTts?.cnyPer10000Characters;
  if (!Number.isFinite(rate)) throw invalidCreditArgument("缺少 Qwen TTS 费率");
  return resultFromCny((characters / 10000) * rate, resolved, { characters });
}

export function calculateQwenVoiceCloneCost(settings) {
  const resolved = requireSettings(settings);
  const rate = resolved.rates.qwenTts?.voiceCloneUsd;
  if (!Number.isFinite(rate)) throw invalidCreditArgument("缺少 Qwen 音色克隆费率");
  return resultFromUsd(rate, resolved);
}

export function calculateMiniMaxTtsCost({
  characters,
  quality,
  firstVoiceClone = false,
} = {}, settings) {
  const resolved = requireSettings(settings);
  assertCount(characters, "characters");
  if (typeof firstVoiceClone !== "boolean") {
    throw invalidCreditArgument("firstVoiceClone 必须是布尔值");
  }
  const rates = resolved.rates.minimaxTts;
  const characterRate = rates?.cnyPer10000Characters?.[quality];
  if (!Number.isFinite(characterRate)) {
    throw invalidCreditArgument("quality 只能是 hd 或 turbo");
  }
  const costCny = (characters / 10000) * characterRate
    + (firstVoiceClone ? rates.firstVoiceCloneCny : 0);
  return resultFromCny(costCny, resolved, { characters, quality, firstVoiceClone });
}

export function calculateSeedAudioCost({ durationSeconds } = {}, settings) {
  const resolved = requireSettings(settings);
  assertAmount(durationSeconds, "durationSeconds");
  const rate = resolved.rates.seedAudio?.cnyPerMinute;
  if (!Number.isFinite(rate)) throw invalidCreditArgument("缺少 Seed Audio 费率");
  return resultFromCny((durationSeconds / 60) * rate, resolved, { durationSeconds });
}

export function calculateMediaKitCost({ durationSeconds } = {}, settings) {
  const resolved = requireSettings(settings);
  assertAmount(durationSeconds, "durationSeconds");
  const rate = resolved.rates.mediaKit?.cnyPerMinute;
  if (!Number.isFinite(rate)) throw invalidCreditArgument("缺少 MediaKit 费率");
  return resultFromCny((durationSeconds / 60) * rate, resolved, { durationSeconds });
}
