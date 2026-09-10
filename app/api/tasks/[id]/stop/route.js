import WorkbenchTask from '@/models/WorkbenchTask';
import { workbenchRoute } from '@/lib/server/workbench/apiHelpers';
import { ownedTask } from '@/lib/server/workbench/tasks';
import { signalTaskStop, syncTaskConversation } from '@/lib/server/workbench/runner';
import { appendTaskEvent } from '@/lib/server/workbench/events';
import { ACTIVE_TASK_STATUSES } from '@/lib/server/workbench/config';
export const runtime='nodejs';
export async function POST(req,context) {
  return workbenchRoute(req,async(userId)=>{
    const task=await ownedTask(userId,(await context.params).id);
    if(ACTIVE_TASK_STATUSES.includes(task.status)) {
      const queued=await WorkbenchTask.findOneAndUpdate({_id:task._id,userId,status:'queued'},{$set:{stopRequested:true,status:'stopped',finishedAt:new Date()}},{new:true});
      if(!queued) await WorkbenchTask.updateOne({_id:task._id,userId,status:{$in:['running','waiting_media','waiting_approval']}},{$set:{stopRequested:true}});
      signalTaskStop(task._id);
      if (queued) await syncTaskConversation(task._id);
      await appendTaskEvent(task,'stop_requested','用户已停止任务');
    }
    return Response.json({task:await ownedTask(userId,String(task._id))});
  });
}
