import { localizedRoute } from '@/lib/server/localizedRoute';
import { workbenchRoute } from '@/lib/server/workbench/apiHelpers';
import { ownedTask } from '@/lib/server/workbench/tasks';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function GETHandler(req,context) {
  return workbenchRoute(req,async(userId)=>Response.json({task:await ownedTask(userId,(await context.params).id)}));
}

export const GET = localizedRoute(GETHandler);
