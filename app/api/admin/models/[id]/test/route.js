import { requireAdmin } from '@/lib/admin';
import { forbiddenResponse } from '@/lib/server/api/routeHelpers';
import { modelApiError,routeId,testManagedModel } from '@/lib/server/models/api';
export async function POST(request,context) {
 if(!await requireAdmin(request))return forbiddenResponse();
 try{return Response.json(await testManagedModel(await routeId(context)));}catch(error){return modelApiError(error);}
}
