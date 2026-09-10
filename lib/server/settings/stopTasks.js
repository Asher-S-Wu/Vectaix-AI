import WorkbenchTask from '@/models/WorkbenchTask';
import { ACTIVE_TASK_STATUSES } from '@/lib/server/workbench/config';

export async function stopTasksForSettings(userId, scope = {}) {
  const tasks = await WorkbenchTask.find({ userId, ...scope, status: { $in: ACTIVE_TASK_STATUSES } }).select('_id status').lean();
  if (!tasks.length) return;
  await WorkbenchTask.updateMany({ userId, _id: { $in: tasks.map(task => task._id) } }, { $set: { stopRequested: true } });
  const { signalTaskStop, syncTaskConversation } = await import('@/lib/server/workbench/runner');
  for (const task of tasks) {
    signalTaskStop(task._id);
    if (task.status === 'queued') {
      await WorkbenchTask.updateOne({ _id: task._id, status: 'queued' }, { $set: { status: 'stopped', finishedAt: new Date(), error: '使用权限已更改，任务已停止' } });
      await syncTaskConversation(task._id);
    }
  }
}
