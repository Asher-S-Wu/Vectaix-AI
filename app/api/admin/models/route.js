import { requireAdmin } from '@/lib/admin';
import { forbiddenResponse,parseJsonRequest } from '@/lib/server/api/routeHelpers';
import { listManagedModels, saveModel } from '@/lib/server/models/service';
import { modelApiError } from '@/lib/server/models/api';
export const dynamic='force-dynamic';
export async function GET(request) {
 if(!await requireAdmin(request))return forbiddenResponse();
 try{return Response.json({models:await listManagedModels({admin:true})},{headers:{'Cache-Control':'no-store'}});}catch(error){return modelApiError(error);}
}
export async function POST(request) {
 if(!await requireAdmin(request))return forbiddenResponse();
 const parsed=await parseJsonRequest(request,'请求格式无效',64000);if(!parsed.ok)return parsed.response;
 try{return Response.json({model:await saveModel(parsed.body,{create:true})},{status:201});}catch(error){return modelApiError(error);}
}
