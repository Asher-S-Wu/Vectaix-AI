import crypto from 'node:crypto';
import WorkbenchTask from '@/models/WorkbenchTask';
import { getBillingSettings } from '@/lib/server/credits/settings';
import { createPricingSnapshot } from '@/lib/server/credits/pricing';
import { calculateAccumulatedCosts } from '@/lib/server/credits/chatCosts';
import { estimateChatInputTokens } from '@/lib/server/credits/chatEstimation';
import { reserveCredits, settleCredits, releaseCredits, markReviewRequired } from '@/lib/server/credits/service';
import { getManagedModel } from '@/lib/server/models/service';
import { WORKBENCH_LIMITS } from './config';
import { appendTaskEvent } from './events';

export async function createTaskBilling(task, signal, {files=[]}={}) {
  const settings = await getBillingSettings();
  const modelConfig = await getManagedModel(task.model);
  const provider = modelConfig.provider;
  const snapshot = createPricingSnapshot(settings);
  let active = null;
  const api = {
    async resolveMaxOutputTokens({ pass, inputPayload }) {
      if (active?.pass === pass) return active.outputTokens;
      if (active) throw new Error('上一轮模型用量尚未结算');
      const inputTokens = estimateChatInputTokens({ inputPayload, provider:modelConfig.protocol==='gemini'?'gemini':provider,files:files.filter(file=>modelConfig.nativeInputs.includes(file.category)) });
      const contextRemaining=modelConfig.contextWindow-inputTokens;
      const minimumOutput=Math.min(512,modelConfig.maxOutputTokens);
      if(contextRemaining<minimumOutput)throw new Error('资料超出当前模型的上下文长度，请减少资料或选择更大上下文的模型');
      const outputTokens = Math.min(WORKBENCH_LIMITS.maxOutputTokens, modelConfig.maxOutputTokens, contextRemaining);
      const operationId = `workbench:${task._id}:${pass}`;
      const claimId = crypto.randomUUID();
      const reserved = await reserveCredits({ operationId, userId: String(task.userId), feature: 'workbench_chat', provider, model: task.model,
        usage: { taskId: String(task._id), pass, requestFingerprint: task.fingerprint }, pricingSnapshot: snapshot, executionClaimId: claimId });
      if (reserved.status !== 'reserved' || reserved.executionClaimId !== claimId) throw new Error('本轮任务已经执行，请勿重复提交');
      active = { pass, operationId, outputTokens, dispatched: false, ids: [] };
      await WorkbenchTask.updateOne({ _id: task._id }, { $set: { activeOperationId: operationId } });
      return outputTokens;
    },
    async onUpstreamRequest() {
      if (!active) throw new Error('尚未创建本轮费用记录');
      await appendTaskEvent(task, 'model', '正在分析资料并安排下一步', { pass: active.pass });
      signal.throwIfAborted();
      active.dispatched = true;
    },
    onUsageRecord(record) { if (active) active.usageRecord = record; },
    onUpstreamId(id) { if (active && id && !active.ids.includes(id)) active.ids.push(id); },
    async onPassComplete({ completion }) {
      if (!active) throw new Error('本轮费用记录不存在');
      if (!completion.usageRecord) throw new Error('模型未返回完整用量，本轮费用需要核查');
      const costs = calculateAccumulatedCosts({ model: task.model, provider, usageRecords: [completion.usageRecord], settings, requestFingerprint: task.fingerprint });
      const transaction = await settleCredits({ operationId: active.operationId, ...costs, usage: { ...costs.usage, taskId: String(task._id), pass: active.pass }, pricingSnapshot: snapshot, upstreamRequestIds: active.ids });
      if (transaction.status !== 'settled') throw new Error('本轮费用记录需要核查');
      await WorkbenchTask.updateOne({ _id: task._id, activeOperationId: active.operationId }, { $inc: { costCny: transaction.actualCostCny }, $set: { activeOperationId: null } });
      active = null;
      await appendTaskEvent(task, 'billing', `本轮消耗 ¥${transaction.actualCostCny.toFixed(6)}`, { costCny: transaction.actualCostCny });
    },
    async finalizeFailure() {
      if (!active) return;
      if (active.usageRecord) {
        try { await api.onPassComplete({ completion: { usageRecord: active.usageRecord } }); return; }
        catch (error) { if (!active) throw error; }
      }
      if (active.dispatched) {
        await markReviewRequired(active.operationId, { reason: '工作台模型请求已发出，但未完成用量结算', upstreamRequestIds: active.ids });
        await WorkbenchTask.updateOne({ _id: task._id }, { $set: { billingReviewRequired: true } });
      } else {
        await releaseCredits(active.operationId);
        await WorkbenchTask.updateOne({ _id: task._id }, { $set: { activeOperationId: null } });
      }
      active = null;
    },
  };
  return api;
}
