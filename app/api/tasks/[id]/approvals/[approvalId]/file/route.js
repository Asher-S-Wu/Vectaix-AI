import {workbenchRoute} from '@/lib/server/workbench/apiHelpers';
import {readApprovalSnapshot} from '@/lib/server/workbench/approvals';
export const runtime='nodejs';
export async function GET(req,context){return workbenchRoute(req,async userId=>{const p=await context.params;const file=await readApprovalSnapshot(userId,p.id,p.approvalId);return new Response(file.input,{headers:{'Content-Type':file.mimeType || 'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});});}
