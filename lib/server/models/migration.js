import mongoose from 'mongoose';
import dbConnect from '@/lib/db';
import ModelProvider from '@/models/ModelProvider';
import ManagedModel from '@/models/ManagedModel';
import BillingSettings from '@/models/BillingSettings';
import { DEFAULT_RATES } from '@/lib/server/credits/constants';
import { encryptSecret } from '@/lib/server/security/secrets.mjs';

const legacyModels = [
  ['gpt-6-astra','GPT-6 Astra','openai','legacy-responses','openai/gpt-6-astra',1000000,128000,{reasoning:{effort:'max',summary:'auto'},text:{verbosity:'high'},include:['reasoning.encrypted_content'],service_tier:'default'}],
  ['claude-opus-5','Claude Opus 5','anthropic','legacy-openrouter','claude-opus-5',1000000,128000,{reasoning:{effort:'max'},cache_control:{type:'ephemeral'}}],
  ['google/gemini-3.8-flash','Gemini 3.8 Flash','google','legacy-openrouter','google/gemini-3.8-flash',1000000,65536,{reasoning:{effort:'high'}}],
  ['grok-4.6','Grok 4.6','xai','legacy-openrouter','grok-4.6',256000,32768,{reasoning:{effort:'high'}}],
  ['kimi-k3','Kimi K3','moonshot','legacy-openrouter','kimi-k3',262144,131072,{}],
  ['qwen-3.8-max-0902','Qwen 3.8 Max 0902','qwen','legacy-qwen','qwen3.8-max-0902',262144,32768,{enable_thinking:true,preserve_thinking:false}],
];
export function modelRegistryCollection() { return mongoose.connection.collection('model_registry'); }
export async function ensureModelMigration() {
  await dbConnect();
  const registry = modelRegistryCollection();
  if ((await registry.findOne({_id:'default'}))?.migratedAt) return;
  await Promise.all([ManagedModel.init(),ModelProvider.init()]);
  const stored = await BillingSettings.findOne({key:'default'}).lean();
  for (const [id,name,protocol,baseUrl,keyName] of [
    ['legacy-openrouter','OpenRouter','chat-completions','https://openrouter.ai/api/v1','OPENROUTER_API_KEY'],
    ['legacy-responses','OpenRouter Responses','responses','https://openrouter.ai/api/v1','OPENROUTER_API_KEY'],
    ['legacy-qwen','阿里云千问','chat-completions','https://ws-2t7yj3g991jc5yo6.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1','DASHSCOPE_SINGAPORE_API_KEY'],
  ]) {
    const key = process.env[keyName]?.trim();
    await ModelProvider.updateOne({id},{$setOnInsert:{id,name,protocol,baseUrl,enabled:true,...(key ? {encryptedKey:encryptSecret(key,`provider:${id}`)} : {})}},{upsert:true});
  }
  for (const [sortOrder,definition] of legacyModels.entries()) {
    const [id,name,group,providerId,upstreamModel,contextWindow,maxOutputTokens,requestOptions] = definition;
    const rate = stored?.rates?.chat?.[id] || DEFAULT_RATES.chat[id];
    const pricing = {inputPerMillion:rate.inputPerMillion,outputPerMillion:rate.outputPerMillion,cachedInputPerMillion:rate.cachedInputPerMillion ?? rate.inputPerMillion,cacheWritePerMillion:rate.cacheWritePerMillion ?? rate.inputPerMillion};
    if (rate.longContextThreshold) Object.assign(pricing,{longContextThreshold:rate.longContextThreshold,longInputMultiplier:rate.longInputMultiplier ?? rate.longContextMultiplier,longOutputMultiplier:rate.longOutputMultiplier ?? rate.longContextMultiplier});
    await ManagedModel.updateOne({id},{$setOnInsert:{id,name,group,providerId,upstreamModel,contextWindow,maxOutputTokens,requestOptions,pricing,sortOrder,isDefault:false,enabled:true,supportsTools:true,supportsWebSearch:true,nativeInputs:group==='google'?['text','image','audio','video']:['text','image'],billingMode:group==='qwen'?'tokens':'upstream-cost'}},{upsert:true});
  }
  await registry.updateOne({_id:'default'},{$setOnInsert:{defaultModelId:'google/gemini-3.8-flash',migratedAt:new Date()}},{upsert:true});
}
