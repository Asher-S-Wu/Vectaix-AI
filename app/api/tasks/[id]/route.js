import { workbenchRoute } from '@/lib/server/workbench/apiHelpers';
import { ownedTask } from '@/lib/server/workbench/tasks';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(req,context) {
  return workbenchRoute(req,async(userId)=>Response.json({task:await ownedTask(userId,(await context.params).id)}));
}
