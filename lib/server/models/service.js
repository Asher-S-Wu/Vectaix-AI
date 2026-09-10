import ModelProvider from '@/models/ModelProvider';
import ManagedModel from '@/models/ManagedModel';
import { decryptSecret, encryptSecret } from '@/lib/server/security/secrets.mjs';
import { assertPublicUrl } from '@/lib/server/security/publicUrl.mjs';
import { ensureModelMigration, modelRegistryCollection } from './migration';
import { modelError, publicModel, publicProvider, validateModel, validateProvider } from './validation.mjs';
import { MEDIA_MODELS } from '@/lib/media/shared/models';
import { isDeepStrictEqual } from 'node:util';

const connectionFields=['providerId','upstreamModel','contextWindow','maxOutputTokens','nativeInputs','supportsTools','supportsWebSearch','requestOptions','billingMode'];
export async function clearModelDefaults(ids) {
  await modelRegistryCollection().updateOne({_id:'default',defaultModelId:{$in:ids}},{$set:{defaultModelId:null}});
  await modelRegistryCollection().updateOne({_id:'default',transcriptionModelId:{$in:ids}},{$set:{transcriptionModelId:null}});
}

export async function listManagedModels({admin=false}={}) {
  await ensureModelMigration();
  const [models,providers,registry] = await Promise.all([ManagedModel.find({}).sort({sortOrder:1,id:1}).lean(),ModelProvider.find({}).lean(),modelRegistryCollection().findOne({_id:'default'})]);
  const providerMap = new Map(providers.map(provider => [provider.id,provider]));
  return models.filter(model => admin || (model.enabled && providerMap.get(model.providerId)?.enabled)).map(model => {
    const result = {...model,provider:model.group,protocol:providerMap.get(model.providerId)?.protocol,isDefault:registry.defaultModelId===model.id,isTranscriptionDefault:registry.transcriptionModelId===model.id};
    return admin ? {...result,_id:undefined,__v:undefined} : publicModel(result);
  });
}
export async function getPublicModels() { const models=await listManagedModels(); return {models,defaultModelId:models.find(model=>model.isDefault)?.id || null}; }
export async function getDefaultTranscriptionModel() {
  await ensureModelMigration();
  const registry=await modelRegistryCollection().findOne({_id:'default'});
  if (!registry.transcriptionModelId) throw modelError('尚未设置默认语音转写模型，请联系管理员',503);
  const model=await getManagedModel(registry.transcriptionModelId);
  if (!model.nativeInputs.includes('audio')) throw modelError('默认转写模型不支持音频',409);
  return model;
}
export async function getModelBillingSettings(id) {
  const model=await getManagedModel(id);
  const {getBillingSettings}=await import('@/lib/server/credits/settings');
  return {model,settings:await getBillingSettings()};
}
export async function getManagedModel(id,{includeDisabled=false}={}) {
  await ensureModelMigration();
  const model = await ManagedModel.findOne({id}).lean();
  if (!model) throw modelError('模型不存在',404);
  const provider = await ModelProvider.findOne({id:model.providerId}).lean();
  if (!provider) throw modelError('模型服务商不存在',409);
  if (!includeDisabled && (!model.enabled || !provider.enabled)) throw modelError('此模型已停用，请选择其他模型',409);
  return {...model,provider:model.group,protocol:provider.protocol};
}
export async function getModelConnection(id,options) {
  const model = await getManagedModel(id,options);
  const provider = await ModelProvider.findOne({id:model.providerId}).select('+encryptedKey').lean();
  if (!provider.encryptedKey) throw modelError('此模型服务商尚未设置密钥',503);
  await assertPublicUrl(provider.baseUrl);
  return {model,provider:{id:provider.id,baseUrl:provider.baseUrl,protocol:provider.protocol,updatedAt:provider.updatedAt,apiKey:decryptSecret(provider.encryptedKey,`provider:${provider.id}`)}};
}
export async function getManagedChatRates() {
  await ensureModelMigration();
  return Object.fromEntries((await ManagedModel.find({}).lean()).map(model=>[model.id,{...model.pricing,provider:model.group,currency:'USD',billingMode:model.billingMode}]));
}
export async function listProviders() { await ensureModelMigration(); return (await ModelProvider.find({}).select('+encryptedKey').sort({name:1}).lean()).map(publicProvider); }
export async function saveProvider(input,{create=false}={}) {
  await ensureModelMigration();
  const value=validateProvider(input);
  await assertPublicUrl(value.baseUrl);
  const old=await ModelProvider.findOne({id:value.id}).lean();
  if (create && old) throw modelError('服务商标识已存在',409);
  if (!create && !old) throw modelError('服务商不存在',404);
  if (old && old.protocol !== value.protocol && await ManagedModel.exists({providerId:value.id})) throw modelError('服务商已有模型，不能修改接口协议；请新建服务商',409);
  if (input.apiKey !== undefined && input.apiKey !== '') {
    if (typeof input.apiKey !== 'string' || !input.apiKey.trim() || input.apiKey.length>10000) throw modelError('密钥无效');
    value.encryptedKey=encryptSecret(input.apiKey.trim(),`provider:${value.id}`);
  }
  const document=await ModelProvider.findOneAndUpdate({id:value.id},{$set:value},{upsert:create,new:true,runValidators:true}).select('+encryptedKey').lean();
  if(old&&(old.baseUrl!==value.baseUrl||value.encryptedKey)) {
    const models=await ManagedModel.find({providerId:value.id}).select('id').lean();
    await ManagedModel.updateMany({providerId:value.id},{$set:{enabled:false,connectionTestedAt:null}});
    await clearModelDefaults(models.map(model=>model.id));
  }
  return publicProvider(document);
}
export async function deleteProvider(id) {
  await ensureModelMigration();
  if (await ManagedModel.exists({providerId:id})) throw modelError('请先删除或转移此服务商下的模型',409);
  if (!(await ModelProvider.deleteOne({id})).deletedCount) throw modelError('服务商不存在',404);
}
export async function saveModel(input,{create=false}={}) {
  await ensureModelMigration();
  const value=validateModel(input);
  if(MEDIA_MODELS.some(model=>model.id===value.id))throw modelError('此标识已用于图片或视频创作，请使用其他模型标识',409);
  const provider=await ModelProvider.findOne({id:value.providerId}).lean();
  if (!provider) throw modelError('请选择已保存的服务商');
  if (['responses','anthropic'].includes(provider.protocol) && value.nativeInputs.some(type=>['audio','video'].includes(type))) throw modelError('此接口目前仅支持文字和图片输入');
  if (value.supportsWebSearch && !value.supportsTools) throw modelError('联网搜索需要开启工具调用');
  const old=await ManagedModel.findOne({id:value.id}).lean();
  if (create && old) throw modelError('模型标识已存在',409);
  if (!create && !old) throw modelError('模型不存在',404);
  if(create&&value.enabled)throw modelError('新模型必须先以停用状态保存，连接测试通过后才能启用',409);
  const connectionChanged=old&&connectionFields.some(key=>!isDeepStrictEqual(old[key],value[key]));
  if(connectionChanged) {
    value.enabled=false;value.connectionTestedAt=null;value.isDefault=false;value.isTranscriptionDefault=false;
  } else if(value.enabled&&!old?.enabled&&!old?.connectionTestedAt)throw modelError('请先完成连接测试，再启用模型',409);
  if ((value.isDefault || value.isTranscriptionDefault) && (!value.enabled || !provider.enabled)) throw modelError('默认模型及其服务商必须启用');
  const makeDefault=value.isDefault;
  const makeTranscriptionDefault=value.isTranscriptionDefault;
  delete value.isTranscriptionDefault;
  value.isDefault=false;
  const saved=await ManagedModel.findOneAndUpdate({id:value.id,...(!create?{updatedAt:old.updatedAt}:{})},{$set:value},{upsert:create,new:true,runValidators:true});
  if(!saved)throw modelError('模型配置已发生变化，请刷新后重试',409);
  if (makeDefault) await modelRegistryCollection().updateOne({_id:'default'},{$set:{defaultModelId:value.id}});
  else await modelRegistryCollection().updateOne({_id:'default',defaultModelId:value.id},{$set:{defaultModelId:null}});
  if (makeTranscriptionDefault) await modelRegistryCollection().updateOne({_id:'default'},{$set:{transcriptionModelId:value.id}});
  else await modelRegistryCollection().updateOne({_id:'default',transcriptionModelId:value.id},{$set:{transcriptionModelId:null}});
  return (await listManagedModels({admin:true})).find(model=>model.id===value.id);
}
export async function deleteModel(id) {
  await ensureModelMigration();
  if (!(await ManagedModel.deleteOne({id})).deletedCount) throw modelError('模型不存在',404);
  await modelRegistryCollection().updateOne({_id:'default',defaultModelId:id},{$set:{defaultModelId:null}});
  await modelRegistryCollection().updateOne({_id:'default',transcriptionModelId:id},{$set:{transcriptionModelId:null}});
}
