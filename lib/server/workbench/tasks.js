import CreditTransaction from "@/models/CreditTransaction";
import Conversation from "@/models/Conversation";
import { syncTaskMediaBilling } from "./mediaTools";
import { withProjectLock } from "./projectLock";
import crypto from 'node:crypto';
import WorkbenchTask from '@/models/WorkbenchTask';
import { isDirectChatModel } from '@/lib/shared/models';
import { requireProject } from './catalog';
import { requireObjectId, workbenchError, textField } from './apiHelpers';
import { startWorkbenchRunner } from './runner';
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
  return WorkbenchTask.findOne({_id:id,userId}).lean();
}
async function createTaskUnlocked(userId,body) {
  const projectId=requireObjectId(body.projectId);
  await requireProject(userId,projectId);
  const prompt=textField(body.prompt,'任务要求',16000,true);
  if(!isDirectChatModel(body.model)) throw workbenchError('请选择有效的对话模型');
  if(typeof body.requestId!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)) throw workbenchError('任务请求编号无效');
  const parentTaskId=body.parentTaskId ? requireObjectId(body.parentTaskId):null;
  if(parentTaskId) {
    const parent=await ownedTask(userId,parentTaskId);
    if(String(parent.projectId)!==projectId || ['queued','running','waiting_media'].includes(parent.status)) throw workbenchError('只能继续同一项目中已结束的任务');
  }
  const sourceConversationId = body.sourceConversationId ? requireObjectId(body.sourceConversationId) : null;
  if (sourceConversationId && parentTaskId) throw workbenchError('不能同时选择前一任务和对话');
  let sourceContext = '';
  if (sourceConversationId) {
    const conversation = await Conversation.findOne({ _id: sourceConversationId, userId, projectId }).select('title messages').lean();
    if (!conversation) throw workbenchError('项目对话不存在', 404);
    const messages = conversation.messages.slice(-30).map(message => ({ role: message.role, content: typeof message.content === 'string' && message.content ? message.content : (message.parts || []).filter(part => typeof part.text === 'string').map(part => part.text).join('\n') }));
    sourceContext = JSON.stringify({ title: conversation.title, recentMessages: messages }).slice(-60000);
  }
  const mediaSettings=body.mediaSettings ?? {};
  if(!mediaSettings || typeof mediaSettings!=='object' || Array.isArray(mediaSettings) || JSON.stringify(mediaSettings).length>20000) throw workbenchError('媒体设置无效');
  const input={projectId,prompt,model:body.model,parentTaskId,sourceConversationId,mediaSettings};
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
  await startWorkbenchRunner();
  const existing=await WorkbenchTask.findOne({userId,requestId:body.requestId}).lean();
  if(existing) {
    if(existing.fingerprint!==fingerprint) throw workbenchError('请求编号已用于其他任务',409);
    return existing;
  }
  if(await WorkbenchTask.countDocuments({userId,status:'queued'})>=WORKBENCH_LIMITS.maxQueuedPerUser) throw workbenchError('排队任务已达到上限',429);
  try {return (await WorkbenchTask.create({userId,...input,sourceContext,requestId:body.requestId,fingerprint})).toObject();}
  catch(error) {
    if(error.code!==11000) throw error;
    const task=await WorkbenchTask.findOne({userId,requestId:body.requestId}).lean();
    if(!task || task.fingerprint!==fingerprint) throw workbenchError('任务请求冲突',409);
    return task;
  }
}

export async function createTask(userId, body) {
  const projectId = requireObjectId(body.projectId);
  return withProjectLock(userId, projectId, () => createTaskUnlocked(userId, body));
}
