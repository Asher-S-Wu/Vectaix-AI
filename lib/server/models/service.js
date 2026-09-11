import { MODEL_CONFIGS, MODEL_PROVIDERS, DEFAULT_MODEL_ID, TRANSCRIPTION_MODEL_ID } from './config';

function modelError(message,status) { return Object.assign(new Error(message),{status,publicMessage:true}); }
export async function getPublicModels() {
  const fields=['id','name','providerId','group','provider','enabled','isDefault','isTranscriptionDefault','sortOrder','contextWindow','maxOutputTokens','nativeInputs','supportsTools','supportsWebSearch','pricing','billingMode','protocol'];
  return {models:MODEL_CONFIGS.map(model=>structuredClone(Object.fromEntries(fields.map(key=>[key,model[key]])))),defaultModelId:DEFAULT_MODEL_ID};
}
export async function getManagedModel(id) {
  const model=MODEL_CONFIGS.find(model=>model.id===id);
  if(!model)throw modelError('模型不存在',404);
  return structuredClone(model);
}
export async function getDefaultTranscriptionModel() { return getManagedModel(TRANSCRIPTION_MODEL_ID); }
export async function getModelBillingSettings(id) {
  const model=await getManagedModel(id);
  const {getBillingSettings}=await import('@/lib/server/credits/settings');
  return {model,settings:await getBillingSettings()};
}
export async function getModelConnection(id) {
  const model=await getManagedModel(id);
  const config=MODEL_PROVIDERS[model.providerId];
  const apiKey=process.env[config.keyEnv]?.trim();
  if(!apiKey)throw modelError('模型服务尚未配置',503);
  return {model,provider:{id:config.id,baseUrl:config.baseUrl,protocol:config.protocol,apiKey}};
}
export async function getManagedChatRates() {
  return Object.fromEntries(MODEL_CONFIGS.map(model=>[model.id,{...model.pricing,provider:model.group,currency:'USD',billingMode:model.billingMode}]));
}
