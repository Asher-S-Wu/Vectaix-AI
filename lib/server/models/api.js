import { modelError } from './validation.mjs';
import ManagedModel from '@/models/ManagedModel';
import ModelProvider from '@/models/ModelProvider';
import { getModelConnection } from './service';
import { calculateAccumulatedCosts } from '@/lib/server/credits/chatCosts';
import { getBillingSettings } from '@/lib/server/credits/settings';
export function modelApiError(error) {
  const status=Number.isInteger(error.status)?error.status:500;
  return Response.json({error:status<500||error.publicMessage?error.message:'模型设置操作失败，请检查服务配置'}, {status,headers:{'Cache-Control':'no-store'}});
}
export async function routeId(context) { const {id}=await context.params;if(typeof id!=='string'||!id)throw modelError('标识无效');return id; }
export async function testManagedModel(id,{runModel}={}) {
  const {runConfiguredChat}=await import('@/lib/server/providers/directChat');
  const connection=await getModelConnection(id,{includeDisabled:true});
  const started=Date.now();
  try {
    const result=await (runModel||runConfiguredChat)({model:id,messages:[{role:'user',content:'请只回答：连接成功'}],system:'简短回答。',onText(){},onThought(){},maxToolPasses:1,resolveMaxOutputTokens:async()=>Math.min(4096,connection.model.maxOutputTokens),signal:AbortSignal.timeout(45000)},connection);
    if(!result.text?.trim())throw modelError('连接测试未返回有效文字',502);
    if(!Array.isArray(result.usageRecords)||!result.usageRecords.length)throw modelError('连接测试未返回可计费的用量，不能启用此模型',502);
    calculateAccumulatedCosts({model:id,provider:connection.model.provider,usageRecords:result.usageRecords,settings:await getBillingSettings()});
    if(!await ModelProvider.exists({id:connection.provider.id,updatedAt:connection.provider.updatedAt}))throw modelError('服务商配置已发生变化，请重新测试',409);
    const saved=await ManagedModel.updateOne({id,updatedAt:connection.model.updatedAt},{$set:{connectionTestedAt:new Date()}});
    if(!saved.matchedCount)throw modelError('模型配置已发生变化，请重新测试',409);
    return {success:true,text:result.text.slice(0,300),durationMs:Date.now()-started,usage:result.usage};
  } catch(error) {
    await ManagedModel.updateOne({id,updatedAt:connection.model.updatedAt},{$set:{connectionTestedAt:null}});
    throw error;
  }
}
