import mongoose from 'mongoose';
import StoredFile from '@/models/StoredFile';
import WorkspaceDocument from '@/models/WorkspaceDocument';
import WorkbenchTaskEvent from '@/models/WorkbenchTaskEvent';
import { bindStoredFiles, collectStoredFileIds, deleteStoredFilesByIds, deleteStoredFilesByOwner } from '@/lib/server/storage/service';
import { createScopedFileQuery } from './documents';
import CreditTransaction from "@/models/CreditTransaction";
import Conversation from "@/models/Conversation";
import { syncTaskMediaBilling } from "./mediaTools";
import { withProjectLock } from "./projectLock";
import crypto from 'node:crypto';
import WorkbenchTask from '@/models/WorkbenchTask';
import { getManagedModel } from '@/lib/server/models/service';
import { requireProject } from './catalog';
import { requireObjectId, workbenchError, textField } from './apiHelpers';
import { startWorkbenchRunner, syncTaskConversation } from './runner';
import { WORKBENCH_LIMITS } from './config';

export async function ownedTask(userId,id) {
  requireObjectId(id);
  let task=await WorkbenchTask.findOne({_id:id,userId}).lean();
  if(!task) throw workbenchError('任务不存在',404);
  if(task.mediaTasks.length) await syncTaskMediaBilling(task);
  const operationIds = [task.activeOperationId, ...task.mediaTasks.map(media => media.operationId)].filter(Boolean);
  if (operationIds.length) {
    const transactions = await CreditTransaction.find({ userId, operationId: { $in: operationIds } }).select('operationId status charged').lean();
    const modelTransaction = transactions.find(item => item.operationId === task.activeOperationId);
    if (modelTransaction && ['settled', 'released', 'rejected'].includes(modelTransaction.status)) {
      await WorkbenchTask.updateOne({ _id: id, userId, activeOperationId: task.activeOperationId }, { $inc: { chargedPoints: modelTransaction.charged }, $set: { activeOperationId: null } });
    }
    const modelUnresolved = task.activeOperationId && (!modelTransaction || !['settled', 'released', 'rejected'].includes(modelTransaction.status));
    const billingReviewRequired = transactions.some(item => item.status === 'review_required') || (['failed','stopped','interrupted'].includes(task.status) && Boolean(modelUnresolved));
    await WorkbenchTask.updateOne({ _id: id, userId }, { $set: { billingReviewRequired } });
  }
  await syncTaskConversation(id);
  return WorkbenchTask.findOne({_id:id,userId}).lean();
}
async function createTaskUnlocked(userId, body) {
  const projectId = body.projectId ? requireObjectId(body.projectId) : null;
  const conversationId = body.conversationId ? requireObjectId(body.conversationId) : null;
  if (projectId) await requireProject(userId, projectId);
  const prompt = textField(body.prompt ?? '', '消息', 16000);
  if (!prompt && !body.attachments?.length) throw workbenchError('请输入消息或上传附件');
  await getManagedModel(body.model);
  if (typeof body.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)) throw workbenchError('请求编号无效');
  const mediaSettings = body.mediaSettings ?? {};
  if (!mediaSettings || typeof mediaSettings !== 'object' || Array.isArray(mediaSettings) || JSON.stringify(mediaSettings).length > 20000) throw workbenchError('媒体设置无效');
  const chatSystemPrompt = textField(body.chatSystemPrompt ?? '', '对话指令', 30000);
  const webSearch = { enabled: body.webSearch?.enabled === true };
  const attachments = body.attachments ?? [];
  if (!Array.isArray(attachments) || attachments.length > 20 || attachments.some(x => !x || typeof x.fileId !== 'string')) throw workbenchError('附件无效');
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ conversationId, projectId, prompt, model: body.model, attachments, webSearch, mediaSettings, chatSystemPrompt, parentTaskId: body.parentTaskId, replaceFromMessageId: body.replaceFromMessageId })).digest('hex');
  await startWorkbenchRunner();
  const existing = await WorkbenchTask.findOne({ userId, requestId: body.requestId }).lean();
  if (existing) {
    if (existing.fingerprint !== fingerprint) throw workbenchError('请求编号已用于其他消息', 409);
    return { task: existing, conversation: await Conversation.findOne({ _id: existing.conversationId, userId }).lean() };
  }
  if (await WorkbenchTask.countDocuments({ userId, status: 'queued' }) >= WORKBENCH_LIMITS.maxQueuedPerUser) throw workbenchError('排队消息已达到上限', 429);
  let conversation = conversationId ? await Conversation.findOne({ _id: conversationId, userId }).lean() : null;
  if (conversationId && !conversation) throw workbenchError('对话不存在', 404);
  if (conversation && String(conversation.projectId ?? '') !== String(projectId ?? '')) throw workbenchError('对话所属项目不一致', 409);
  if (!conversation && body.parentTaskId) throw workbenchError('继续任务时请选择原对话');
  const newConversation = !conversation;
  if (!conversation) conversation = (await Conversation.create({ userId, projectId, title: prompt ? prompt.slice(0, 60) : '附件分析', model: body.model })).toObject();
  const parentTaskId = body.parentTaskId ? requireObjectId(body.parentTaskId) : null;
  if (parentTaskId && !await WorkbenchTask.exists({ _id: parentTaskId, userId, conversationId: conversation._id, status: { $nin: ['queued','running','waiting_media','waiting_approval'] } })) throw workbenchError('只能继续本对话中已结束的任务');
  const taskId = new mongoose.Types.ObjectId();
  const locked = await Conversation.findOneAndUpdate({ _id: conversation._id, userId, activeTaskId: null }, { $set: { activeTaskId: taskId } }, { new: true }).lean();
  if (!locked) throw workbenchError('当前对话正在回复，请先停止或等待完成', 409);
  let created = false;
  const userMessageId = crypto.randomUUID();
  let boundTemporaryIds = [];
  try {
    const ids = [...new Set(attachments.map(x => x.fileId))];
    const scopedQuery = await createScopedFileQuery({ userId, projectId, conversationId: String(conversation._id) });
    const files = ids.length ? await StoredFile.find({ userId, fileId: { $in: ids }, $or: [{ ownerType: 'temporary' }, scopedQuery] }).lean() : [];
    if (files.length !== ids.length) throw workbenchError('附件不存在或不属于当前对话', 403);
    if (body.replaceFromMessageId && !locked.messages.some(message => message.id === body.replaceFromMessageId && message.role === 'user')) throw workbenchError('要编辑的消息不存在');
    boundTemporaryIds = files.filter(x => x.ownerType === 'temporary').map(x => x.fileId);
    await bindStoredFiles({ userId, fileIds: boundTemporaryIds, ownerType: 'conversation', ownerId: String(conversation._id) });
    await WorkspaceDocument.updateMany({ userId, fileId: { $in: files.filter(x => x.ownerType === 'temporary').map(x => x.fileId) } }, { $set: { conversationId: conversation._id, projectId } });
    let messages = locked.messages;
    if (body.replaceFromMessageId) {
      const index = messages.findIndex(x => x.id === body.replaceFromMessageId && x.role === 'user');
      if (index < 0) throw workbenchError('要编辑的消息不存在');
      const keptFileIds = new Set([...collectStoredFileIds(messages.slice(0, index)), ...ids]);
      const removedFileIds = collectStoredFileIds(messages.slice(index)).filter(fileId => !keptFileIds.has(fileId));
      await WorkspaceDocument.deleteMany({ userId, conversationId: conversation._id, fileId: { $in: removedFileIds } });
      await deleteStoredFilesByIds({ userId, fileIds: removedFileIds, ownerType: 'conversation', ownerId: String(conversation._id) });
      const taskIds = messages.slice(index).map(x => x.taskId).filter(Boolean);
      const reused = files.filter(file => file.ownerType === 'task' && taskIds.some(taskId => String(taskId) === file.ownerId)).map(file => file.fileId);
      if (reused.length) {
        await StoredFile.updateMany({ userId, fileId: { $in: reused } }, { $set: { ownerType: 'conversation', ownerId: String(conversation._id) } });
        await WorkspaceDocument.updateMany({ userId, fileId: { $in: reused } }, { $set: { conversationId: conversation._id, projectId } });
      }
      const deletedFiles = await StoredFile.find({ userId, ownerType: 'task', ownerId: { $in: taskIds.map(String) } }).select('fileId').lean();
      await WorkspaceDocument.deleteMany({ userId, fileId: { $in: deletedFiles.map(file => file.fileId) } });
      for (const id of taskIds) await deleteStoredFilesByOwner({ userId, ownerType: 'task', ownerId: String(id) });
      await WorkbenchTaskEvent.deleteMany({ userId, taskId: { $in: taskIds } });
      await WorkbenchTask.deleteMany({ userId, _id: { $in: taskIds } });
      messages = messages.slice(0, index);
    }
    const modelMessageId = crypto.randomUUID();
    const parts = [...(prompt ? [{ text: prompt }] : []), ...files.map(file => file.category === 'image' ? { inlineData: { fileId: file.fileId, mimeType: file.mimeType, url: `/api/files/${file.fileId}` } } : { fileData: { fileId: file.fileId, mimeType: file.mimeType, url: `/api/files/${file.fileId}`, name: file.originalName, extension: file.extension, category: file.category, size: file.size } })];
    messages.push({ id: userMessageId, role: 'user', content: prompt, type: 'parts', parts, createdAt: new Date() }, { id: modelMessageId, role: 'model', content: '', taskId, taskStatus: 'queued', createdAt: new Date() });
    conversation = await Conversation.findOneAndUpdate({ _id: conversation._id, userId, activeTaskId: taskId }, { $set: { messages, model: body.model, 'settings.webSearch': webSearch, updatedAt: new Date() } }, { new: true }).lean();
    const task = (await WorkbenchTask.create({ _id: taskId, userId, projectId, conversationId: conversation._id, userMessageId, modelMessageId, prompt, model: body.model, parentTaskId, mediaSettings, webSearch, chatSystemPrompt, fingerprint, requestId: body.requestId })).toObject();
    created = true;
    return { task, conversation };
  } finally {
    if (!created) {
      await Conversation.updateOne({ _id: conversation._id, userId, activeTaskId: taskId }, { $set: { activeTaskId: null }, $pull: { messages: { $or: [{ taskId }, { id: userMessageId }] } } });
      await StoredFile.updateMany({ userId, fileId: { $in: boundTemporaryIds }, ownerType: 'conversation', ownerId: String(conversation._id) }, { $set: { ownerType: 'temporary', ownerId: null } });
      await WorkspaceDocument.updateMany({ userId, fileId: { $in: boundTemporaryIds }, conversationId: conversation._id }, { $set: { conversationId: null, projectId: null } });
      if (newConversation) {
        await Conversation.deleteOne({ _id: conversation._id, userId, activeTaskId: null, messages: { $size: 0 } });
      }
    }
  }
}

export async function createTask(userId, body) {
  return withProjectLock(userId, 'task-creation', () => body.projectId ? withProjectLock(userId, requireObjectId(body.projectId), () => createTaskUnlocked(userId, body)) : createTaskUnlocked(userId, body));
}
