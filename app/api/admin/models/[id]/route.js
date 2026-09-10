import { requireAdmin } from '@/lib/admin';
import { forbiddenResponse,parseJsonRequest } from '@/lib/server/api/routeHelpers';
import { saveModel,deleteModel } from '@/lib/server/models/service';
import { modelApiError,routeId } from '@/lib/server/models/api';
export async function PATCH(request,context) {
 if(!await requireAdmin(request))return forbiddenResponse();
 const parsed=await parseJsonRequest(request,'请求格式无效',64000);if(!parsed.ok)return parsed.response;
 try{return Response.json({model:await saveModel({...parsed.body,id:await routeId(context)})});}catch(error){return modelApiError(error);}
}
export async function DELETE(request,context) {
 if(!await requireAdmin(request))return forbiddenResponse();
 try{await deleteModel(await routeId(context));return Response.json({success:true});}catch(error){return modelApiError(error);}
}
