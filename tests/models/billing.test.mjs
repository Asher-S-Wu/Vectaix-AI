import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateAccumulatedCosts} from '../../lib/server/credits/chatCosts.js';
import {calculateChatCost} from '../../lib/server/credits/pricing.js';
import * as pricing from '../../lib/server/credits/pricing.js';
import {DEFAULT_BILLING_SETTINGS} from '../../lib/server/credits/constants.js';
import {estimateChatInputTokens} from '../../lib/server/credits/chatEstimation.js';
const settings={version:3,pricingDate:'2026-09-18',usdToCny:1,rates:{chat:{
 custom:{billingMode:'tokens',inputPerMillion:2,cachedInputPerMillion:1,cacheWritePerMillion:3,outputPerMillion:6},
 'gpt-6-astra':{billingMode:'tokens',inputPerMillion:10,cachedInputPerMillion:1,cacheWritePerMillion:12.5,outputPerMillion:50,longContextThreshold:272000,longInputMultiplier:2,longOutputMultiplier:1.5},
 'grok-4.6':{billingMode:'tokens',inputPerMillion:2,cachedInputPerMillion:.5,outputPerMillion:6,longContextThreshold:200000,longContextMultiplier:2,longContextInclusive:true},
 'kimi-k3':{billingMode:'tokens',inputPerMillion:3,cachedInputPerMillion:.3,outputPerMillion:15},
}}};
test('自定义服务商按配置的 token 单价结算，不依赖 OpenRouter cost',()=>{
  const result=calculateAccumulatedCosts({model:'custom',provider:'自定义',usageRecords:[{usage:{input_tokens:1000000,output_tokens:500000,cost:999,input_tokens_details:{cached_tokens:200000},cache_write_tokens:100000}}],settings});
  assert.equal(result.actualCostUsd,4.9);
  assert.equal(result.actualCostCny,4.9);
  assert.equal('openRouterUsageCost' in result.usage, false);
});
test('缺少或无效的实际 token 用量时拒绝结算，不回退到供应商 cost',()=>{
  assert.throws(()=>calculateAccumulatedCosts({model:'custom',provider:'x',usageRecords:[],settings}),/完整/);
  assert.throws(()=>calculateAccumulatedCosts({model:'custom',provider:'x',usageRecords:[{usage:{cost:0.12,input_tokens:5}}],settings}),/token/);
  assert.throws(()=>calculateAccumulatedCosts({model:'custom',provider:'x',usageRecords:[{usage:{cost:0.12,input_tokens:5,output_tokens:'3'}}],settings}),/token/);
  assert.throws(()=>calculateAccumulatedCosts({model:'custom',provider:'x',usageRecords:[{usage:{input_tokens:5,output_tokens:3,prompt_tokens_details:{cached_tokens:'2'}}}],settings}),/token/);
  const result=calculateChatCost({model:'custom',inputTokens:5,outputTokens:3,openRouterUsageCost:0.12},settings);
  assert.equal(result.costUsd,0.000028);
  assert.equal('calculateOpenRouterUsageCost' in pricing, false);
});
test('多轮用量累加并读取 Kimi prompt_tokens_details.cached_tokens',()=>{
  const result=calculateAccumulatedCosts({model:'kimi-k3',provider:'moonshot',usageRecords:[
    {usage:{input_tokens:1000000,output_tokens:1000000,prompt_tokens_details:{cached_tokens:200000},cost:0.01}},
    {usage:{input_tokens:100000,output_tokens:50000,prompt_tokens_details:{cached_tokens:50000},cost:0.02}},
  ],settings});
  assert.equal(result.actualCostUsd,18.375);
  assert.deepEqual(result.usage,{model:'kimi-k3',requestFingerprint:undefined,inputTokens:1100000,cachedInputTokens:250000,cacheWriteTokens:0,outputTokens:1050000,usageRecords:[
    {usage:{input_tokens:1000000,output_tokens:1000000,prompt_tokens_details:{cached_tokens:200000},cost:0.01}},
    {usage:{input_tokens:100000,output_tokens:50000,prompt_tokens_details:{cached_tokens:50000},cost:0.02}},
  ]});
});
test('GPT 长上下文严格在超过 272000 输入 token 后生效，Grok 在达到 200000 时生效',()=>{
  assert.equal(calculateChatCost({model:'gpt-6-astra',inputTokens:272000,outputTokens:0},settings).costUsd,2.72);
  assert.equal(calculateChatCost({model:'gpt-6-astra',inputTokens:272001,outputTokens:0},settings).costUsd,5.44002);
  assert.equal(calculateChatCost({model:'grok-4.6',inputTokens:199999,outputTokens:0},settings).costUsd,0.399998);
  assert.equal(calculateChatCost({model:'grok-4.6',inputTokens:200000,outputTokens:0},settings).costUsd,0.8);
});
test('缓存、缓存写入和输出分别使用对应费率',()=>{
  const result=calculateChatCost({model:'custom',inputTokens:1000000,cachedInputTokens:200000,cacheWriteTokens:100000,outputTokens:500000},settings);
  assert.equal(result.costUsd,4.9);
});

test('长上下文倍率覆盖缓存和输出，并按每轮输入量决定',()=>{
  const gpt=calculateChatCost({model:'gpt-6-astra',inputTokens:272001,cachedInputTokens:100000,cacheWriteTokens:10000,outputTokens:10000},DEFAULT_BILLING_SETTINGS);
  assert.equal(gpt.costUsd,4.44002);
  const grok=calculateChatCost({model:'grok-4.6',inputTokens:200000,cachedInputTokens:100000,outputTokens:10000},DEFAULT_BILLING_SETTINGS);
  assert.equal(grok.costUsd,0.62);
  const rounds=calculateAccumulatedCosts({model:'grok-4.6',usageRecords:[
    {usage:{input_tokens:100000,output_tokens:10000,cost:999}},
    {usage:{input_tokens:100000,output_tokens:10000,cost:999}},
  ],settings:DEFAULT_BILLING_SETTINGS});
  assert.equal(rounds.actualCostUsd,0.52);
});
test('版本 3 的五个模型按官方标准费率计费',()=>{
  assert.equal(DEFAULT_BILLING_SETTINGS.version,3);
  assert.equal(DEFAULT_BILLING_SETTINGS.pricingDate,'2026-09-18');
  assert.equal(DEFAULT_BILLING_SETTINGS.usdToCny,6.72);
  assert.equal(calculateChatCost({model:'gpt-6-astra',inputTokens:100000,cachedInputTokens:10000,cacheWriteTokens:10000,outputTokens:10000},DEFAULT_BILLING_SETTINGS).costUsd,1.435);
  assert.equal(calculateChatCost({model:'claude-opus-5',inputTokens:100000,cachedInputTokens:10000,cacheWriteTokens:10000,outputTokens:10000},DEFAULT_BILLING_SETTINGS).costUsd,0.7175);
  assert.equal(calculateChatCost({model:'google/gemini-3.8-flash',inputTokens:100000,cachedInputTokens:20000,outputTokens:10000},DEFAULT_BILLING_SETTINGS).costUsd,0.099);
  assert.equal(calculateChatCost({model:'grok-4.6',inputTokens:199999,cachedInputTokens:99999,outputTokens:100000},DEFAULT_BILLING_SETTINGS).costUsd,0.8499995);
  assert.equal(calculateChatCost({model:'kimi-k3',inputTokens:100000,cachedInputTokens:20000,outputTokens:10000},DEFAULT_BILLING_SETTINGS).costUsd,0.396);
});
test('输出 token 已含推理 token，结算时不重复计算推理明细',()=>{
  const result=calculateAccumulatedCosts({model:'custom',provider:'x',usageRecords:[{usage:{input_tokens:100,output_tokens:100,output_tokens_details:{reasoning_tokens:80}}}],settings});
  assert.equal(result.actualCostUsd,0.0008);
  assert.equal(result.usage.outputTokens,100);
});
test('额外工具图片纳入预算，已有文件图片不会被重复估算',()=>{
 const image={type:'image_url',image_url:{url:'data:image/png;base64,aGVsbG8='}};
 const file={category:'image'};
 const one=estimateChatInputTokens({inputPayload:{messages:[image]},provider:'openai',files:[file]});
 const two=estimateChatInputTokens({inputPayload:{messages:[image,image]},provider:'openai',files:[file]});
 assert.ok(one<4200);
 assert.ok(two-one>=4096);
 const native=estimateChatInputTokens({inputPayload:{contents:[{parts:[{inlineData:{mimeType:'image/png',data:'a'.repeat(100000)}}]}]},provider:'gemini'});
 assert.ok(native>=4128&&native<4300);
});
