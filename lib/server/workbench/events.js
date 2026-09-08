import { withProjectLock } from "./projectLock";
import WorkbenchTask from '@/models/WorkbenchTask';
import WorkbenchTaskEvent from '@/models/WorkbenchTaskEvent';

export async function appendTaskEvent(task, type, message, data = null) {
  return withProjectLock("events", String(task._id), async () => {
  const updated = await WorkbenchTask.findOneAndUpdate(
    { _id: task._id, userId: task.userId }, { $inc: { eventSeq: 1 } }, { new: true },
  ).select('eventSeq').lean();
  if (!updated) throw new Error('任务已不存在');
  return WorkbenchTaskEvent.create({ taskId: task._id, userId: task.userId, seq: updated.eventSeq, type, message, data });
  });
}
