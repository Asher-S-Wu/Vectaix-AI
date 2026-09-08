import WorkbenchTaskEvent from '@/models/WorkbenchTaskEvent';
import { workbenchRoute, workbenchError } from '@/lib/server/workbench/apiHelpers';
import { ownedTask } from '@/lib/server/workbench/tasks';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(req,context) {
  return workbenchRoute(req,async(userId)=>{
    const task=await ownedTask(userId,(await context.params).id);
    const after=Number(new URL(req.url).searchParams.get('after') || 0);
    if(!Number.isSafeInteger(after) || after<0) throw workbenchError('步骤游标无效');
    const events=await WorkbenchTaskEvent.find({taskId:task._id,userId,seq:{$gt:after}}).sort({seq:1}).limit(100).lean();
    return Response.json({events});
  });
}
