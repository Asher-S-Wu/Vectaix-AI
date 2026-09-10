import { requireAdmin } from '@/lib/admin';
import { forbiddenResponse,parseJsonRequest } from '@/lib/server/api/routeHelpers';
import { getManagedModel } from '@/lib/server/models/service';
import { modelApiError,routeId,testManagedModel } from '@/lib/server/models/api';
import { modelError } from '@/lib/server/models/validation.mjs';
export async function POST(request,context) {
 if(!await requireAdmin(request))return forbiddenResponse();
 const parsed=await parseJsonRequest(request,'请求格式无效',4000);if(!parsed.ok)return parsed.response;
 try {
  const model=await getManagedModel(parsed.body.modelId,{includeDisabled:true});
  if(model.providerId!==await routeId(context))throw modelError('模型不属于此服务商');
  return Response.json(await testManagedModel(model.id));
 }catch(error){return modelApiError(error);}
}
