import { localizedRoute } from '@/lib/server/localizedRoute';
import {workbenchRoute,readBody} from '@/lib/server/workbench/apiHelpers';
import UserConnection from '@/models/UserConnection';
import {ownedConnection,updateConnection,serializeConnection} from '@/lib/server/integrations/connections';
export const runtime='nodejs';
async function PATCHHandler(req,context){return workbenchRoute(req,async userId=>Response.json({connection:serializeConnection(await updateConnection(userId,(await context.params).id,await readBody(req)))}));}
async function DELETEHandler(req,context){return workbenchRoute(req,async userId=>{const c=await ownedConnection(userId,(await context.params).id);await UserConnection.deleteOne({_id:c._id,userId});return Response.json({deleted:true});});}

export const PATCH = localizedRoute(PATCHHandler);
export const DELETE = localizedRoute(DELETEHandler);
