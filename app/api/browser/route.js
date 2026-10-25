import { localizedRoute } from '@/lib/server/localizedRoute';
import {workbenchRoute} from '@/lib/server/workbench/apiHelpers';
import {browserStatus,closeBrowser} from '@/lib/server/browser/service';
export const runtime='nodejs';export const dynamic='force-dynamic';
async function GETHandler(req){return workbenchRoute(req,async userId=>Response.json(browserStatus(userId)));}
async function DELETEHandler(req){return workbenchRoute(req,async userId=>{await closeBrowser(userId,{revoke:new URL(req.url).searchParams.get('revoke')==='true'});return Response.json({closed:true});});}

export const GET = localizedRoute(GETHandler);
export const DELETE = localizedRoute(DELETEHandler);
