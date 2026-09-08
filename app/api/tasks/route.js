import Conversation from '@/models/Conversation';
import WorkbenchTask from '@/models/WorkbenchTask';
import { workbenchRoute, readBody, requireObjectId, workbenchError } from '@/lib/server/workbench/apiHelpers';
import { requireProject } from '@/lib/server/workbench/catalog';
import { createTask, ownedTask } from '@/lib/server/workbench/tasks';
import { WORKBENCH_LIMITS } from '@/lib/server/workbench/config';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(req) {
  return workbenchRoute(req,async(userId)=>{
    const projectId=new URL(req.url).searchParams.get('projectId');
    const conversationId=new URL(req.url).searchParams.get('conversationId');
    if(conversationId && !await Conversation.exists({_id:requireObjectId(conversationId),userId})) throw workbenchError('对话不存在',404);
    if(projectId) await requireProject(userId,requireObjectId(projectId));
    const tasks=await WorkbenchTask.find({userId,...(projectId?{projectId}:{}),...(conversationId?{conversationId}:{})}).sort({createdAt:-1}).limit(100).lean();
    for (let index = 0; index < tasks.length; index++) {
      const task = tasks[index];
      if (task.billingReviewRequired || task.activeOperationId || task.mediaTasks.some(media => !['completed','failed','canceled'].includes(media.status))) tasks[index] = await ownedTask(userId, String(task._id));
    }
    return Response.json({tasks,limits:WORKBENCH_LIMITS});
  });
}
export async function POST(req) {
  return workbenchRoute(req,async(userId)=>Response.json(await createTask(userId,await readBody(req)),{status:201}));
}
