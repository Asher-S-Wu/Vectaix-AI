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
  assertAmount(settings.usdToCny, "usdToCny");
  if (settings.usdToCny === 0) {
    throw invalidCreditArgument("usdToCny 必须大于 0");
  }
  if (!settings.rates || typeof settings.rates !== "object") {
    throw invalidCreditArgument("缺少完整费率表");
  }
  return settings;
}

function resultFromCny(cny, settings, details = {}) {
  const amountCny = assertAmount(cny, "costCny");
  return {
    costCny: amountCny,
    costUsd: null,
    ...details,
  };
}

function resultFromUsd(usd, settings, details = {}) {
  const amountUsd = assertAmount(usd, "costUsd");
  return {
    costCny: amountUsd * settings.usdToCny,
    costUsd: amountUsd,
    ...details,
  };
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

export function calculateGptImageCost({ model, usage } = {}, settings) {
  const resolved = requireSettings(settings);
  const rate = resolved.rates.gptImage?.[model];
  if (!rate) throw invalidCreditArgument(`没有图片模型 ${model} 的计费费率`);
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    throw invalidCreditArgument("图片用量明细不完整：缺少 usage");
  }
  const inputTokens = assertCount(usage.input_tokens, "usage.input_tokens");
  const outputTokens = assertCount(usage.output_tokens, "usage.output_tokens");
  const totalTokens = assertCount(usage.total_tokens, "usage.total_tokens");
  const inputDetails = usage.input_tokens_details;
  if (!inputDetails || typeof inputDetails !== "object" || Array.isArray(inputDetails)) {
    throw invalidCreditArgument("图片输入用量明细不完整");
  }
  const textInputTokens = assertCount(inputDetails.text_tokens, "usage.input_tokens_details.text_tokens");
  const imageInputTokens = assertCount(inputDetails.image_tokens, "usage.input_tokens_details.image_tokens");
  if (textInputTokens + imageInputTokens !== inputTokens) {
    throw invalidCreditArgument("图片输入总用量与文字、图片分类用量不一致");
  }
  if (inputTokens + outputTokens !== totalTokens) {
    throw invalidCreditArgument("图片总用量与输入、输出用量不一致");
  }

  let cachedTextInputTokens = 0;
  let cachedImageInputTokens = 0;
  const cachedDetails = inputDetails.cached_tokens_details;
  if (inputDetails.cached_tokens !== undefined) {
    assertCount(inputDetails.cached_tokens, "usage.input_tokens_details.cached_tokens");
  }
  if (cachedDetails !== undefined) {
    if (!cachedDetails || typeof cachedDetails !== "object" || Array.isArray(cachedDetails)) {
      throw invalidCreditArgument("图片缓存用量明细不完整");
    }
    cachedTextInputTokens = assertCount(cachedDetails.text_tokens, "cached_tokens_details.text_tokens");
    cachedImageInputTokens = assertCount(cachedDetails.image_tokens, "cached_tokens_details.image_tokens");
  } else if (inputDetails.cached_tokens > 0) {
    throw invalidCreditArgument("图片缓存用量明细不完整：缺少文字和图片缓存分类");
  }
  if (inputDetails.cached_tokens !== undefined && inputDetails.cached_tokens !== cachedTextInputTokens + cachedImageInputTokens) {
    throw invalidCreditArgument("图片缓存总用量与分类用量不一致");
  }
  if (cachedTextInputTokens > textInputTokens || cachedImageInputTokens > imageInputTokens) {
    throw invalidCreditArgument("图片缓存用量不能超过对应分类的输入用量");
  }

  const outputDetails = usage.output_tokens_details;
  if (outputDetails !== undefined) {
    if (!outputDetails || typeof outputDetails !== "object" || Array.isArray(outputDetails)) {
      throw invalidCreditArgument("图片输出用量明细不完整");
    }
    const imageOutputTokens = assertCount(outputDetails.image_tokens, "usage.output_tokens_details.image_tokens");
    if (outputDetails.text_tokens !== undefined && assertCount(outputDetails.text_tokens, "usage.output_tokens_details.text_tokens") !== 0) {
      throw invalidCreditArgument("图片模型的文字输出没有对应费率");
    }
    if (imageOutputTokens !== outputTokens) {
      throw invalidCreditArgument("图片输出用量与总输出用量不一致");
    }
  }

  const breakdown = {
    textInputUsd: (textInputTokens - cachedTextInputTokens) * assertAmount(rate.textInputPerMillion, "textInputPerMillion") / 1_000_000,
    cachedTextInputUsd: cachedTextInputTokens * assertAmount(rate.cachedTextInputPerMillion, "cachedTextInputPerMillion") / 1_000_000,
    imageInputUsd: (imageInputTokens - cachedImageInputTokens) * assertAmount(rate.imageInputPerMillion, "imageInputPerMillion") / 1_000_000,
    cachedImageInputUsd: cachedImageInputTokens * assertAmount(rate.cachedImageInputPerMillion, "cachedImageInputPerMillion") / 1_000_000,
    imageOutputUsd: outputTokens * assertAmount(rate.imageOutputPerMillion, "imageOutputPerMillion") / 1_000_000,
  };
  return resultFromUsd(Object.values(breakdown).reduce((sum, amount) => sum + amount, 0), resolved, {
    source: "openai_image_tokens",
    model,
    inputTokens,
    textInputTokens,
    imageInputTokens,
    cachedTextInputTokens,
    cachedImageInputTokens,
    outputTokens,
    totalTokens,
    breakdown,
  });
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
