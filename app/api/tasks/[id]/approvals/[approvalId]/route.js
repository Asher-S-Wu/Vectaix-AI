import {workbenchRoute,readBody} from '@/lib/server/workbench/apiHelpers';
import {decideApproval} from '@/lib/server/workbench/approvals';
export const runtime='nodejs';
export async function POST(req,context){return workbenchRoute(req,async userId=>{const p=await context.params;return Response.json({approval:await decideApproval(userId,p.id,p.approvalId,(await readBody(req)).decision)});});}
