import {workbenchRoute,readBody} from '@/lib/server/workbench/apiHelpers';
import {browserStatus,closeBrowser} from '@/lib/server/browser/service';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(req){return workbenchRoute(req,async userId=>Response.json(browserStatus(userId)));}
export async function DELETE(req){return workbenchRoute(req,async userId=>{await closeBrowser(userId,{revoke:new URL(req.url).searchParams.get('revoke')==='true'});return Response.json({closed:true});});}
