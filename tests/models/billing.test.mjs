import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAccumulatedCosts } from '../../lib/server/credits/chatCosts.js';
import { calculateChatCost } from '../../lib/server/credits/pricing.js';
import { DEFAULT_BILLING_SETTINGS } from '../../lib/server/credits/constants.js';
import { estimateChatInputTokens } from '../../lib/server/credits/chatEstimation.js';

const model = 'deepseek-flash';
const timestamp = value => Date.parse(value) / 1000;
const peak = timestamp('2026-10-23T02:00:00Z');
const cost = (created, usage = {}) => calculateChatCost({ model, created, inputTokens: 1000000, cachedInputTokens: 200000, outputTokens: 500000, ...usage }, DEFAULT_BILLING_SETTINGS);

test('官方费率分别计算缓存、输入与输出用量', () => {
  assert.deepEqual(Object.keys(DEFAULT_BILLING_SETTINGS.rates.chat), [model]);
  assert.ok(Math.abs(cost(peak).costUsd - 0.8412) < 1e-12);
  assert.ok(Math.abs(cost(peak).costCny - 0.8412 * 6.72) < 1e-12);
});

test('峰谷边界、周末和中国节假日按对应时段费率计费', () => {
  for (const [date, multiplier] of [
    ['2026-10-23T00:59:59Z', .5], ['2026-10-23T01:00:00Z', 1],
    ['2026-10-23T03:59:59Z', 1], ['2026-10-23T04:00:00Z', .5],
    ['2026-10-23T05:59:59Z', .5], ['2026-10-23T06:00:00Z', 1],
    ['2026-10-23T09:59:59Z', 1], ['2026-10-23T10:00:00Z', .5],
    ['2026-10-24T02:00:00Z', .5], ['2026-10-01T02:00:00Z', .5],
  ]) assert.equal(cost(timestamp(date)).periodMultiplier, multiplier, date);
  assert.throws(() => cost(undefined), /created/);
  assert.throws(() => cost(timestamp('2027-01-01T02:00:00Z')), /日历/);
});

test('跨时段工具调用按每轮实际用量与创建时间累计', () => {
  const usageRecords = [
    { created: peak, usage: { input_tokens: 1000000, output_tokens: 500000, input_tokens_details: { cached_tokens: 200000 } } },
    { created: timestamp('2026-10-23T04:00:00Z'), usage: { input_tokens: 1000000, output_tokens: 500000, input_tokens_details: { cached_tokens: 200000 }, output_tokens_details: { reasoning_tokens: 100000 } } },
  ];
  const result = calculateAccumulatedCosts({ model, usageRecords, settings: DEFAULT_BILLING_SETTINGS });
  assert.ok(Math.abs(result.actualCostUsd - 1.2618) < 1e-12);
  assert.equal(result.usage.inputTokens, 2000000);
  assert.equal(result.usage.cachedInputTokens, 400000);
  assert.equal(result.usage.outputTokens, 1000000);
});

test('缺少或无效的实际用量进入核查流程', () => {
  const run = usageRecords => calculateAccumulatedCosts({ model, usageRecords, settings: DEFAULT_BILLING_SETTINGS });
  assert.throws(() => run([]), /完整/);
  assert.throws(() => run([{ created: peak, usage: { input_tokens: 5 } }]), /token/);
  assert.throws(() => run([{ created: peak, usage: { input_tokens: 5, output_tokens: '3' } }]), /token/);
  assert.throws(() => run([{ created: peak, usage: { input_tokens: 5, output_tokens: 3, input_tokens_details: { cached_tokens: 6 } } }]), /缓存/);
});

test('图片内容从文字预算中分离，工具图片计入输入预算', () => {
  const image = { type: 'input_image', image_url: `data:image/png;base64,${'a'.repeat(100000)}` };
  const one = estimateChatInputTokens({ inputPayload: { messages: [image] }, files: [{ category: 'image' }] });
  const two = estimateChatInputTokens({ inputPayload: { messages: [image, image] }, files: [{ category: 'image' }] });
  assert.ok(one >= 4096 && one < 4200);
  assert.ok(two - one >= 4096);
});

test('三种协议的图片均按媒体预算计算，base64体积不会作为文字计入', () => {
  const payload = 'a'.repeat(1000000);
  for (const image of [
    { type: 'input_image', image_url: `data:image/png;base64,${payload}` },
    { type: 'image_url', image_url: { url: `data:image/png;base64,${payload}` } },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: payload } },
  ]) {
    const estimate = estimateChatInputTokens({ inputPayload: { messages: [image, image] } });
    assert.ok(estimate >= 8192 && estimate < 8300);
  }
});
