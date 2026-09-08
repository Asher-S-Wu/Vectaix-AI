import { withProjectLock } from "./projectLock";
import Conversation from '@/models/Conversation';
import WorkbenchTask from '@/models/WorkbenchTask';
import WorkbenchTaskEvent from '@/models/WorkbenchTaskEvent';

export async function appendTaskEvent(task, type, message, data = null) {
  return withProjectLock("events", String(task._id), async () => {
  const updated = await WorkbenchTask.findOneAndUpdate(
    { _id: task._id, userId: task.userId }, { $inc: { eventSeq: 1 } }, { new: true },
  ).select('eventSeq').lean();
  if (!updated) throw new Error('任务已不存在');
  const event = await WorkbenchTaskEvent.create({ taskId: task._id, userId: task.userId, seq: updated.eventSeq, type, message, data });
  if (task.conversationId && task.modelMessageId) {
    if (type === 'tool_result') {
      await Conversation.updateOne({ _id: task.conversationId, userId: task.userId }, { $set: {
        'messages.$[message].thinkingTimeline.$[step].status': data.success ? 'done' : 'error',
        'messages.$[message].thinkingTimeline.$[step].message': message,
        'messages.$[message].thinkingTimeline.$[step].resultSeq': event.seq,
      } }, { arrayFilters: [{ 'message.id': task.modelMessageId }, { 'step.callId': data.callId, 'step.taskId': String(task._id) }] });
    } else {
      await Conversation.updateOne({ _id: task.conversationId, userId: task.userId, 'messages.id': task.modelMessageId }, { $push: { 'messages.$.thinkingTimeline': {
        id: `${task._id}:${event.seq}`, taskId: String(task._id), kind: 'tool', status: type === 'tool_start' ? 'running' : ['failed','interrupted'].includes(type) ? 'error' : 'done', title: message, eventType: type, seq: event.seq,
        ...(data?.callId ? { callId: data.callId, tool: data.tool } : {}),
      } } });
    }
    if (['completed','failed','stopped','interrupted'].includes(type)) await Conversation.updateOne({ _id: task.conversationId, userId: task.userId }, { $set: { 'messages.$[message].thinkingTimeline.$[step].status': type === 'completed' ? 'done' : 'error' } }, { arrayFilters: [{ 'message.id': task.modelMessageId }, { 'step.taskId': String(task._id), 'step.status': { $in: ['running','streaming'] } }] });
  }
  return event;
  });
}
