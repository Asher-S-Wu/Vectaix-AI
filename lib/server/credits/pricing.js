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
  created,
  inputTokens = 0,
  cachedInputTokens = 0,
  outputTokens = 0,
} = {}, settings) {
  const resolved = requireSettings(settings);
  if (typeof model !== "string" || !model.trim()) {
    throw invalidCreditArgument("model 必须是非空字符串");
  }
  const rate = resolved.rates.chat?.[model];
  if (!rate) throw invalidCreditArgument(`没有模型 ${model} 的计费费率`);
  assertCount(inputTokens, "inputTokens");
  assertCount(cachedInputTokens, "cachedInputTokens");
  assertCount(outputTokens, "outputTokens");
  if (cachedInputTokens > inputTokens) {
    throw invalidCreditArgument("缓存输入 token 不能超过总输入 token");
  }
  assertAmount(rate.inputPerMillion, "inputPerMillion");
  assertAmount(rate.outputPerMillion, "outputPerMillion");
  const uncachedInputTokens = inputTokens - cachedInputTokens;
  const cachedRate = assertAmount(rate.cachedInputPerMillion, 'cachedInputPerMillion');
  const periodMultiplier = rate.offPeakMultiplier === undefined ? 1 : chatPeriodMultiplier(rate, created);
  const costUsd = (
    (uncachedInputTokens * rate.inputPerMillion
      + cachedInputTokens * cachedRate)
    + outputTokens * rate.outputPerMillion
  ) * periodMultiplier / 1_000_000;
  return resultFromUsd(costUsd, resolved, {
    source: "token_usage",
    model,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    periodMultiplier,
  });
}

function chatPeriodMultiplier(rate, created) {
  assertCount(created, 'created');
  const instant = new Date(created * 1000);
  if (!Number.isFinite(instant.getTime())) throw invalidCreditArgument('用量记录时间无效');
  const localDate = new Date(instant.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  const holidays = rate.holidayCalendar?.[localDate.slice(0, 4)];
  if (!holidays) throw invalidCreditArgument('计费节假日日历需要更新');
  const day = localDate.slice(5);
  const holiday = holidays.some(([start, end]) => day >= start && day <= end);
  const weekday = instant.getUTCDay();
  const hour = instant.getUTCHours();
  const peak = weekday >= 1 && weekday <= 5 && !holiday && ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10));
  return peak ? 1 : assertAmount(rate.offPeakMultiplier, 'offPeakMultiplier');
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

export function calculateElevenLabsTtsCost({ characters } = {}, settings) {
  const resolved = requireSettings(settings);
  assertCount(characters, 'characters');
  const rate = resolved.rates.elevenlabsTts?.usdPerThousandCharacters;
  if (!Number.isFinite(rate) || rate < 0) throw invalidCreditArgument('缺少 ElevenLabs 语音费率');
  return resultFromUsd(characters * rate / 1000, resolved, { characters, source: 'upstream_characters' });
}
