import test from 'node:test';
import assert from 'node:assert/strict';
import * as pricing from '../../lib/server/credits/pricing.js';
import { DEFAULT_BILLING_SETTINGS } from '../../lib/server/credits/constants.js';

const SUNBURST = 'gpt-image-2.5-sunburst';
const FLARE = 'gpt-image-2.5-flare';
const referenceUsage = () => ({
  input_tokens: 1100,
  input_tokens_details: { text_tokens: 100, image_tokens: 1000 },
  output_tokens: 200,
  total_tokens: 1300,
});
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

test('参考图和文字分别按 OpenAI 价格收费，人民币使用计费设置汇率', () => {
  assert.equal(typeof pricing.calculateGptImageCost, 'function');
  const result = pricing.calculateGptImageCost({ model: SUNBURST, usage: referenceUsage() }, DEFAULT_BILLING_SETTINGS);
  closeTo(result.costUsd, 0.0145);
  closeTo(result.costCny, 0.09744);
  assert.equal(result.source, 'openai_image_tokens');
  assert.equal(result.model, SUNBURST);
  assert.equal(result.textInputTokens, 100);
  assert.equal(result.imageInputTokens, 1000);
  assert.equal(result.outputTokens, 200);
  assert.equal(result.totalTokens, 1300);
  const customExchangeRate = { ...DEFAULT_BILLING_SETTINGS, usdToCny: 7.5 };
  closeTo(pricing.calculateGptImageCost({ model: SUNBURST, usage: referenceUsage() }, customExchangeRate).costCny, 0.10875);
});

test('文字和图片缓存分别享受对应价格，不重复计入普通输入', () => {
  const usage = referenceUsage();
  usage.input_tokens_details.cached_tokens = 290;
  usage.input_tokens_details.cached_tokens_details = { text_tokens: 40, image_tokens: 250 };
  const result = pricing.calculateGptImageCost({ model: SUNBURST, usage }, DEFAULT_BILLING_SETTINGS);
  closeTo(result.costUsd, 0.01285);
  closeTo(result.costCny, 0.086352);
  assert.equal(result.cachedTextInputTokens, 40);
  assert.equal(result.cachedImageInputTokens, 250);
  assert.deepEqual(result.breakdown, {
    textInputUsd: 0.0003,
    cachedTextInputUsd: 0.00005,
    imageInputUsd: 0.006,
    cachedImageInputUsd: 0.0005,
    imageOutputUsd: 0.006,
  });
  delete usage.input_tokens_details.cached_tokens;
  closeTo(pricing.calculateGptImageCost({ model: FLARE, usage }, DEFAULT_BILLING_SETTINGS).costUsd, 0.01285);
});

test('没有缓存统计的官方基础用量按普通输入价格计算', () => {
  const usage = referenceUsage();
  const withoutCache = pricing.calculateGptImageCost({ model: SUNBURST, usage }, DEFAULT_BILLING_SETTINGS);
  assert.equal(withoutCache.cachedTextInputTokens, 0);
  assert.equal(withoutCache.cachedImageInputTokens, 0);
  usage.input_tokens_details.cached_tokens = 0;
  closeTo(pricing.calculateGptImageCost({ model: SUNBURST, usage }, DEFAULT_BILLING_SETTINGS).costUsd, 0.0145);
});

test('两个模型使用相同价格，但按各自实际用量记账', () => {
  const sunburst = pricing.calculateGptImageCost({ model: SUNBURST, usage: referenceUsage() }, DEFAULT_BILLING_SETTINGS);
  const flare = pricing.calculateGptImageCost({ model: FLARE, usage: referenceUsage() }, DEFAULT_BILLING_SETTINGS);
  closeTo(flare.costUsd, sunburst.costUsd);
  const smallerUsage = { input_tokens: 500, input_tokens_details: { text_tokens: 500, image_tokens: 0 }, output_tokens: 100, total_tokens: 600 };
  closeTo(pricing.calculateGptImageCost({ model: FLARE, usage: smallerUsage }, DEFAULT_BILLING_SETTINGS).costUsd, 0.0055);
});

test('缺少用量或输入分类时拒绝计费', () => {
  const invalidUsages = [undefined, null, {}, { input_tokens: 1100, output_tokens: 200, total_tokens: 1300 }];
  for (const field of ['input_tokens', 'output_tokens', 'total_tokens']) {
    const usage = referenceUsage();
    delete usage[field];
    invalidUsages.push(usage);
  }
  for (const field of ['text_tokens', 'image_tokens']) {
    const usage = referenceUsage();
    delete usage.input_tokens_details[field];
    invalidUsages.push(usage);
  }
  for (const usage of invalidUsages) {
    assert.throws(() => pricing.calculateGptImageCost({ model: SUNBURST, usage }, DEFAULT_BILLING_SETTINGS), error => error.code === 'INVALID_CREDIT_ARGUMENT');
  }
});

test('负数、非整数和不一致的用量不能生成费用', () => {
  const invalidUsages = [];
  for (const value of [-1, 0.5, '100', NaN, Infinity]) {
    for (const field of ['input_tokens', 'output_tokens', 'total_tokens']) {
      invalidUsages.push({ ...referenceUsage(), [field]: value });
    }
    for (const field of ['text_tokens', 'image_tokens']) {
      const usage = referenceUsage();
      usage.input_tokens_details[field] = value;
      invalidUsages.push(usage);
    }
  }
  invalidUsages.push({ ...referenceUsage(), input_tokens: 1101 });
  invalidUsages.push({ ...referenceUsage(), total_tokens: 1301 });
  for (const usage of invalidUsages) {
    assert.throws(() => pricing.calculateGptImageCost({ model: SUNBURST, usage }, DEFAULT_BILLING_SETTINGS), error => error.code === 'INVALID_CREDIT_ARGUMENT');
  }
});

test('缓存用量必须分类完整、总数一致且不超过对应输入', () => {
  const cases = [
    { cached_tokens: 100 },
    { cached_tokens: -1 },
    { cached_tokens: 290, cached_tokens_details: { text_tokens: 40 } },
    { cached_tokens: 290, cached_tokens_details: { image_tokens: 250 } },
    { cached_tokens: 291, cached_tokens_details: { text_tokens: 40, image_tokens: 250 } },
    { cached_tokens_details: { text_tokens: 101, image_tokens: 0 } },
    { cached_tokens_details: { text_tokens: 0, image_tokens: 1001 } },
    { cached_tokens_details: { text_tokens: -1, image_tokens: 0 } },
    { cached_tokens_details: { text_tokens: 0, image_tokens: 0.5 } },
  ];
  for (const details of cases) {
    const usage = referenceUsage();
    Object.assign(usage.input_tokens_details, details);
    assert.throws(() => pricing.calculateGptImageCost({ model: SUNBURST, usage }, DEFAULT_BILLING_SETTINGS), error => error.code === 'INVALID_CREDIT_ARGUMENT');
  }
  const usage = referenceUsage();
  usage.input_tokens_details.cached_tokens = 1;
  assert.throws(() => pricing.calculateGptImageCost({ model: SUNBURST, usage }, DEFAULT_BILLING_SETTINGS), /缓存.*明细不完整/);
});

test('输出明细只能包含可完整确认的图片输出，文字输出不猜价格', () => {
  const usage = referenceUsage();
  usage.output_tokens_details = { image_tokens: 200, text_tokens: 0 };
  closeTo(pricing.calculateGptImageCost({ model: FLARE, usage }, DEFAULT_BILLING_SETTINGS).costUsd, 0.0145);
  for (const details of [{ image_tokens: 199 }, { image_tokens: 200, text_tokens: 1 }, { text_tokens: 0 }, { image_tokens: 200, text_tokens: -1 }]) {
    usage.output_tokens_details = details;
    assert.throws(() => pricing.calculateGptImageCost({ model: FLARE, usage }, DEFAULT_BILLING_SETTINGS), error => error.code === 'INVALID_CREDIT_ARGUMENT');
  }
});

test('计费快照独立保存价格与汇率，计算不修改用量或设置', () => {
  const settings = structuredClone(DEFAULT_BILLING_SETTINGS);
  const usage = referenceUsage();
  const usageBefore = structuredClone(usage);
  const settingsBefore = structuredClone(settings);
  const snapshot = pricing.createPricingSnapshot(settings);
  pricing.calculateGptImageCost({ model: SUNBURST, usage }, snapshot);
  assert.deepEqual(usage, usageBefore);
  assert.deepEqual(settings, settingsBefore);
  settings.usdToCny = 8;
  settings.rates.gptImage[SUNBURST].imageOutputPerMillion = 60;
  closeTo(pricing.calculateGptImageCost({ model: SUNBURST, usage }, snapshot).costCny, 0.09744);
  closeTo(pricing.calculateGptImageCost({ model: SUNBURST, usage }, settings).costCny, 0.164);
  snapshot.rates.gptImage[FLARE].imageInputPerMillion = 100;
  closeTo(pricing.calculateGptImageCost({ model: FLARE, usage }, DEFAULT_BILLING_SETTINGS).costUsd, 0.0145);
});
