import {workbenchRoute,readBody} from '@/lib/server/workbench/apiHelpers';
import UserConnection from '@/models/UserConnection';
import {createConnection,serializeConnection} from '@/lib/server/integrations/connections';
import {parseMcpImport} from '@/lib/server/integrations/policy.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(req){return workbenchRoute(req,async userId=>Response.json({connections:(await UserConnection.find({userId}).sort({createdAt:1}).lean()).map(serializeConnection)}));}
export async function POST(req){return workbenchRoute(req,async userId=>{const body=await readBody(req);const values=body.import?parseMcpImport(body.import):[body];if(values.length>20)throw Object.assign(new Error('一次最多导入 20 个连接'),{status:400});const results=[];for(const value of values)results.push(serializeConnection(await createConnection(userId,value)));return Response.json({connections:results});});}
