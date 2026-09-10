import { modelError } from './validation.mjs';
export function modelApiError(error) {
  const status=Number.isInteger(error.status)?error.status:500;
  return Response.json({error:status<500||error.publicMessage?error.message:'模型设置操作失败，请检查服务配置'}, {status,headers:{'Cache-Control':'no-store'}});
}
export async function routeId(context) { const {id}=await context.params;if(typeof id!=='string'||!id)throw modelError('标识无效');return id; }
export async function testManagedModel(id) {
  const {runDirectChat}=await import('@/lib/server/providers/directChat');
  const started=Date.now();
  const result=await runDirectChat({model:id,messages:[{role:'user',content:'请只回答：连接成功'}],system:'简短回答。',onText(){},onThought(){},maxToolPasses:1,resolveMaxOutputTokens:async()=>4096,signal:AbortSignal.timeout(45000)});
  return {success:true,text:result.text.slice(0,300),durationMs:Date.now()-started,usage:result.usage};
}
