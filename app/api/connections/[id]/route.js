import {workbenchRoute,readBody} from '@/lib/server/workbench/apiHelpers';
import UserConnection from '@/models/UserConnection';
import {ownedConnection,updateConnection,serializeConnection} from '@/lib/server/integrations/connections';
export const runtime='nodejs';
export async function PATCH(req,context){return workbenchRoute(req,async userId=>Response.json({connection:serializeConnection(await updateConnection(userId,(await context.params).id,await readBody(req)))}));}
export async function DELETE(req,context){return workbenchRoute(req,async userId=>{const c=await ownedConnection(userId,(await context.params).id);await UserConnection.deleteOne({_id:c._id,userId});return Response.json({deleted:true});});}
