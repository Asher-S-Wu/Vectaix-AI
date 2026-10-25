import { localizedRoute } from '@/lib/server/localizedRoute';
import {workbenchRoute} from '@/lib/server/workbench/apiHelpers';
import {listApprovals} from '@/lib/server/workbench/approvals';
export const runtime='nodejs';export const dynamic='force-dynamic';
async function GETHandler(req,context){return workbenchRoute(req,async userId=>Response.json({approvals:await listApprovals(userId,(await context.params).id)}));}

export const GET = localizedRoute(GETHandler);
