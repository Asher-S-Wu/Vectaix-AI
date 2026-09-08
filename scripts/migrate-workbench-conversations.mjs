import crypto from 'node:crypto';
import mongoose from 'mongoose';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());
if (!process.env.MONGO_URI) throw new Error('缺少 MONGO_URI，无法迁移对话');
await mongoose.connect(process.env.MONGO_URI);
try {
  const database = mongoose.connection.db;
  const tasks = database.collection('workbenchtasks');
  const conversations = database.collection('conversations');
  const documents = database.collection('workspacedocuments');
  const events = database.collection('workbenchtaskevents');
  const legacy = await tasks.find({ conversationId: null }).sort({ createdAt: 1, _id: 1 }).toArray();
  if (legacy.some(task => ['queued', 'running', 'waiting_media'].includes(task.status))) throw new Error('请先停止旧工作台中尚未结束的任务，再执行迁移');
  let migrated = 0;
  for (const task of legacy) {
    let conversation = await conversations.findOne({ userId: task.userId, 'messages.taskId': task._id });
    if (!conversation && task.parentTaskId) {
      const parent = await tasks.findOne({ _id: task.parentTaskId, userId: task.userId, projectId: task.projectId, conversationId: { $ne: null } });
      if (parent) conversation = await conversations.findOne({ _id: parent.conversationId, userId: task.userId });
    }
    if (!conversation && task.sourceConversationId) conversation = await conversations.findOne({ _id: task.sourceConversationId, userId: task.userId, projectId: task.projectId });
    const taskEvents = await events.find({ taskId: task._id, userId: task.userId }).sort({ seq: 1 }).toArray();
    const existingMessage = conversation?.messages?.find(message => String(message.taskId) === String(task._id));
    const userMessageId = existingMessage ? conversation.messages[conversation.messages.indexOf(existingMessage) - 1]?.id : crypto.randomUUID();
    const modelMessageId = existingMessage?.id || crypto.randomUUID();
    const messages = [
      { id: userMessageId, role: 'user', content: task.prompt, type: 'text', parts: [{ text: task.prompt }], createdAt: task.createdAt },
      { id: modelMessageId, role: 'model', content: task.output, thought: task.thought || '', type: 'text', taskId: task._id, taskStatus: task.status, citations: task.citations, artifacts: task.artifacts, createdAt: task.finishedAt || task.createdAt,
        thinkingTimeline: taskEvents.map(event => ({ id: `${task._id}:${event.seq}`, taskId: String(task._id), kind: 'tool', status: ['failed','interrupted'].includes(event.type) ? 'error' : 'done', title: event.message, eventType: event.type, seq: event.seq, ...(event.data?.callId ? { callId: event.data.callId, tool: event.data.tool } : {}) })),
      },
    ];
    if (!conversation) {
      const _id = new mongoose.Types.ObjectId();
      conversation = { _id, userId: task.userId, projectId: task.projectId, title: task.prompt.slice(0, 60), model: task.model, activeTaskId: null, messages, updatedAt: task.finishedAt || task.createdAt, pinned: false };
      await conversations.insertOne(conversation);
    } else if (!existingMessage) {
      await conversations.updateOne({ _id: conversation._id, userId: task.userId }, { $push: { messages: { $each: messages } }, $max: { updatedAt: task.finishedAt || task.createdAt } });
    }
    await tasks.updateOne({ _id: task._id, userId: task.userId, conversationId: null }, { $set: { conversationId: conversation._id, userMessageId, modelMessageId, webSearch: { enabled: true }, chatSystemPrompt: '' } });
    await documents.updateMany({ userId: task.userId, fileId: { $in: task.artifacts.map(file => file.fileId) } }, { $set: { conversationId: conversation._id } });
    migrated++;
  }
  console.log(`已将 ${migrated} 个旧任务迁入原聊天记录。`);
} finally {
  await mongoose.disconnect();
}
