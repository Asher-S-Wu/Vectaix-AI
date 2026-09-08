import WorkbenchTask from '@/models/WorkbenchTask';
import { workbenchRoute, readBody, requireObjectId } from '@/lib/server/workbench/apiHelpers';
import { requireProject } from '@/lib/server/workbench/catalog';
import { createTask } from '@/lib/server/workbench/tasks';
import { WORKBENCH_LIMITS } from '@/lib/server/workbench/config';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(req) {
  return workbenchRoute(req,async(userId)=>{
    const projectId=new URL(req.url).searchParams.get('projectId');
    if(projectId) await requireProject(userId,requireObjectId(projectId));
    const tasks=await WorkbenchTask.find({userId,...(projectId?{projectId}:{})}).sort({createdAt:-1}).limit(100).lean();
    return Response.json({tasks,limits:WORKBENCH_LIMITS});
  });
}
export async function POST(req) {
  return workbenchRoute(req,async(userId)=>Response.json({task:await createTask(userId,await readBody(req))},{status:201}));
}
