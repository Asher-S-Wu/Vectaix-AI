import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateAccumulatedCosts} from '../../lib/server/credits/chatCosts.js';
import {estimateChatInputTokens} from '../../lib/server/credits/chatEstimation.js';
const settings={version:1,pricingDate:'2026-09-10',costMultiplier:1,usdToCny:1,rates:{chat:{custom:{billingMode:'tokens',inputPerMillion:2,cachedInputPerMillion:1,cacheWritePerMillion:3,outputPerMillion:6},router:{billingMode:'upstream-cost',inputPerMillion:1,outputPerMillion:1}}}};
test('自定义服务商按配置的 token 单价结算，不依赖 OpenRouter cost',()=>{
  const result=calculateAccumulatedCosts({model:'custom',provider:'自定义',usageRecords:[{usage:{input_tokens:1000000,output_tokens:500000,input_tokens_details:{cached_tokens:200000},cache_write_tokens:100000}}],settings});
  assert.equal(result.actualCostUsd,4.9);
  assert.equal(result.chargedPoints,490);
});
test('上游实际费用模式严格要求 cost，缺失时不切换计费方法',()=>{
  assert.throws(()=>calculateAccumulatedCosts({model:'router',provider:'x',usageRecords:[{usage:{input_tokens:5,output_tokens:3}}],settings}),/cost/);
  const result=calculateAccumulatedCosts({model:'router',provider:'x',usageRecords:[{usage:{cost:0.12,input_tokens:5,output_tokens:3}}],settings});
  assert.equal(result.chargedPoints,12);
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
