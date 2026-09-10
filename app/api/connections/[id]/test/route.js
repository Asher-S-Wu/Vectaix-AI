import {workbenchRoute} from '@/lib/server/workbench/apiHelpers';
import {ownedConnection,assertExternalToolsEnabled} from '@/lib/server/integrations/connections';
import {testMcp} from '@/lib/server/integrations/mcp';
import {listRemoteFiles} from '@/lib/server/integrations/remotes';
import UserConnection from '@/models/UserConnection';
export const runtime='nodejs';
export async function POST(req,context){return workbenchRoute(req,async userId=>{await assertExternalToolsEnabled(userId);const c=await ownedConnection(userId,(await context.params).id,{secrets:true});const result=c.kind==='mcp'?await testMcp(c):{files:await listRemoteFiles({userId,connectionId:String(c._id)})};await UserConnection.updateOne({_id:c._id,userId},{$set:{testedAt:new Date()}});return Response.json(result);});}
