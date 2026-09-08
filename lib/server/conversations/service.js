import WorkbenchTask from '@/models/WorkbenchTask';
import WorkbenchTaskEvent from '@/models/WorkbenchTaskEvent';
import WorkspaceDocument from '@/models/WorkspaceDocument';
import StoredFile from '@/models/StoredFile';
import { withProjectLock } from '@/lib/server/workbench/projectLock';
import { workbenchError } from '@/lib/server/workbench/apiHelpers';
import Conversation from "@/models/Conversation";
import mongoose from "mongoose";
import { requireProject } from "@/lib/server/workbench/catalog";
import {
  sanitizeConversationBody,
  sanitizeThinkingTimeline,
} from "@/lib/server/conversations/sanitize";
import {
  bindStoredFiles,
  collectStoredFileIds,
  deleteStoredFilesByIds,
  deleteStoredFilesByOwner,
} from "@/lib/server/storage/service";

export function isValidConversationId(id) {
  return mongoose.isValidObjectId(id);
}

export async function getConversationForUser(id, userId) {
  return Conversation.findOne({ _id: id, userId }).lean();
}

async function deleteTaskRecords(userId, taskIds) {
  if (!taskIds.length) return;
  const files = await StoredFile.find({ userId, ownerType: 'task', ownerId: { $in: taskIds.map(String) } }).select('fileId').lean();
  await WorkspaceDocument.deleteMany({ userId, fileId: { $in: files.map(x => x.fileId) } });
  for (const taskId of taskIds) await deleteStoredFilesByOwner({ userId, ownerType: 'task', ownerId: String(taskId) });
  await WorkbenchTaskEvent.deleteMany({ userId, taskId: { $in: taskIds } });
  await WorkbenchTask.deleteMany({ userId, _id: { $in: taskIds } });
}

export async function deleteConversationForUser(id, userId) {
  return withProjectLock(userId, 'task-creation', async () => {
    const conversation = await Conversation.findOne({ _id: id, userId }).lean();
    if (!conversation) return;
    if (conversation.activeTaskId) throw workbenchError('请先停止当前回复，再删除对话', 409);
    const tasks = await WorkbenchTask.find({ userId, conversationId: id }).select('_id').lean();
    await deleteTaskRecords(userId, tasks.map(x => x._id));
    await WorkspaceDocument.deleteMany({ userId, conversationId: id });
    await deleteStoredFilesByOwner({ userId, ownerType: 'conversation', ownerId: id });
    await Conversation.deleteOne({ _id: id, userId, activeTaskId: null });
  });
}

export async function updateConversationForUser(id, userId, body) {
  return withProjectLock(userId, 'task-creation', () => updateConversationUnlocked(id, userId, body));
}

async function updateConversationUnlocked(id, userId, body) {
  const currentConversation = await Conversation.findOne({ _id: id, userId }).select("model messages projectId activeTaskId");
  if (!currentConversation) {
    return null;
  }

  const { projectId, deleteMessageId, ...conversationBody } = body;
  if (currentConversation.activeTaskId && (Object.hasOwn(body, 'messages') || Object.hasOwn(body, 'projectId') || deleteMessageId)) throw workbenchError('请先停止当前回复，再修改对话内容', 409);
  if (Object.hasOwn(body, 'messages') && currentConversation.messages.some(message => message.taskId)) throw workbenchError('请通过消息操作修改此对话，避免覆盖已保存的回复', 409);
  if (deleteMessageId) {
    if (Object.keys(body).length !== 1 || typeof deleteMessageId !== 'string') throw workbenchError('删除消息参数无效');
    const index = currentConversation.messages.findIndex(message => message.id === deleteMessageId);
    if (index < 0) throw workbenchError('消息不存在', 404);
    const count = currentConversation.messages[index].role === 'user' && currentConversation.messages[index + 1]?.role === 'model' ? 2 : 1;
    const removed = currentConversation.messages.splice(index, count);
    await deleteTaskRecords(userId, removed.map(message => message.taskId).filter(Boolean));
    const kept = new Set(collectStoredFileIds(currentConversation.messages));
    const removedFileIds = collectStoredFileIds(removed).filter(fileId => !kept.has(fileId));
    await WorkspaceDocument.deleteMany({ userId, conversationId: id, fileId: { $in: removedFileIds } });
    await deleteStoredFilesByIds({ userId, fileIds: removedFileIds, ownerType: 'conversation', ownerId: id });
    currentConversation.updatedAt = new Date();
    await currentConversation.save();
    return Conversation.findOne({ _id: id, userId });
  }
  const update = sanitizeConversationBody(conversationBody);
  if (Object.hasOwn(body, "projectId")) {
    if (projectId !== null) await requireProject(userId, projectId);
    update.projectId = projectId;
    await WorkbenchTask.updateMany({ userId, conversationId: id }, { $set: { projectId } });
    await WorkspaceDocument.updateMany({ userId, conversationId: id }, { $set: { projectId } });
  }
  const previousFileIds = collectStoredFileIds(currentConversation.messages);
  if (Array.isArray(update.messages)) {
    await bindStoredFiles({
      userId,
      fileIds: collectStoredFileIds(update.messages),
      ownerType: "conversation",
      ownerId: id,
    });
  }

  if (Object.keys(update).length === 0) {
    return Conversation.findOne({ _id: id, userId });
  }
  const updatedConversation = await Conversation.findOneAndUpdate(
    { _id: id, userId },
    { $set: update },
    { new: true }
  );
  if (updatedConversation && Array.isArray(update.messages)) {
    const nextIds = new Set(collectStoredFileIds(update.messages));
    await deleteStoredFilesByIds({
      userId,
      fileIds: previousFileIds.filter((fileId) => !nextIds.has(fileId)),
      ownerType: "conversation",
      ownerId: id,
    });
  }
  return updatedConversation;
}

export async function updateConversationMessageTimeline(id, userId, { messageId, thinkingTimeline }) {
  const normalizedMessageId = typeof messageId === "string" ? messageId.trim() : "";
  if (!normalizedMessageId || normalizedMessageId.length > 128) {
    throw new Error("messageId invalid");
  }
  const timeline = sanitizeThinkingTimeline(thinkingTimeline);
  const updatedConversation = await Conversation.findOneAndUpdate(
    {
      _id: id,
      userId,
      activeTaskId: null,
      messages: { $elemMatch: { id: normalizedMessageId, role: "model", taskId: null } },
    },
    {
      $set: {
        "messages.$[message].thinkingTimeline": timeline,
      },
    },
    {
      new: true,
      arrayFilters: [{ "message.id": normalizedMessageId, "message.role": "model" }],
    },
  ).select("_id");
  return Boolean(updatedConversation);
}
