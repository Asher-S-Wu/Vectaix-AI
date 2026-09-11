import mongoose from 'mongoose';
import CreditTransaction from '@/models/CreditTransaction';
import WorkbenchTask from '@/models/WorkbenchTask';
import WorkbenchTaskEvent from '@/models/WorkbenchTaskEvent';
import StoredFile from '@/models/StoredFile';
import SkillAsset from '@/models/SkillAsset';
import BackupJob from '@/models/BackupJob';
import { deleteStoredFileDocument } from '@/lib/server/storage/service';
import { fileMetadata, referencedFileIds, assertFilesDeletable } from '@/lib/server/files/service';
import { workbenchError, requireObjectId } from '@/lib/server/workbench/apiHelpers';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { getStorageRoot } from '@/lib/server/storage/config';

const SHANGHAI_TIMEZONE = 'Asia/Shanghai';
const todayInShanghai = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);

export function dateFilter(params) {
  const today = todayInShanghai();
  const month = params.get('month') || (!params.has('start') && !params.has('end') ? today.slice(0, 7) : null);
  if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw workbenchError('请选择有效月份');
  const monthEnd = month ? new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10) : null;
  const start = month ? `${month}-01` : params.get('start') || `${today.slice(0, 7)}-01`;
  const end = month ? monthEnd : params.get('end') || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) throw workbenchError('请选择有效日期');
  for (const day of [start, end]) {
    const parsed = new Date(`${day}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) throw workbenchError('请选择有效日期');
  }
  const from = new Date(`${start}T00:00:00+08:00`), to = new Date(`${end}T00:00:00+08:00`); to.setTime(to.getTime() + 86400000);
  if (to <= from || to - from > 366 * 86400000) throw workbenchError('日期范围最多一年');
  const model = params.get('model'); if (model && model.length > 200) throw workbenchError('模型名称过长');
  const taskId = params.get('taskId'); if (taskId) requireObjectId(taskId);
  return { start, end, month, createdAt: { $gte: from, $lt: to }, model, taskId };
}
const costTotals = () => ({
  costCny: { $sum: '$actualCostCny' },
  costUsd: { $sum: '$actualCostUsd' },
  requests: { $sum: 1 },
  unpricedRequests: { $sum: { $cond: [{ $isNumber: '$actualCostCny' }, 0, 1] } },
});
const emptyTotals = () => ({ costCny: 0, costUsd: 0, requests: 0, unpricedRequests: 0 });
export async function usageSummary(userId, params) {
  const filter = dateFilter(params), owner = new mongoose.Types.ObjectId(userId);
  const ownerMatch = { userId: owner, type: 'model_usage', status: { $in: ['settled', 'review_required'] } };
  const match = { ...ownerMatch, createdAt: filter.createdAt, ...(filter.model ? { model: filter.model } : {}), ...(filter.taskId ? { 'usage.taskId': filter.taskId } : {}) };
  const taskMatch = { userId, createdAt: filter.createdAt, ...(filter.model ? { model: filter.model } : {}), ...(filter.taskId ? { _id: filter.taskId } : {}) };
  const [summary, daily, models, taskCosts, tasks, monthly] = await Promise.all([
    CreditTransaction.aggregate([{ $match: match }, { $group: { _id: null, ...costTotals() } }]),
    CreditTransaction.aggregate([{ $match: match }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: SHANGHAI_TIMEZONE } }, ...costTotals() } }, { $sort: { _id: 1 } }]),
    CreditTransaction.aggregate([{ $match: match }, { $group: { _id: '$model', ...costTotals() } }, { $sort: { costCny: -1 } }]),
    CreditTransaction.aggregate([{ $match: { ...match, 'usage.taskId': filter.taskId || { $type: 'string' } } }, { $group: { _id: '$usage.taskId', ...costTotals() } }]),
    WorkbenchTask.find(taskMatch).select('_id model status createdAt finishedAt').sort({ createdAt: -1 }).limit(200).lean(),
    CreditTransaction.aggregate([{ $match: ownerMatch }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: SHANGHAI_TIMEZONE } }, ...costTotals() } }, { $sort: { _id: -1 } }]),
  ]);
  const costs = new Map(taskCosts.map(t => [t._id, t]));
  const currentMonth = todayInShanghai().slice(0, 7);
  return {
    range: { start: filter.start, end: filter.end, month: filter.month },
    summary: summary[0] || emptyTotals(), daily, models, monthly,
    currentMonth: { ...emptyTotals(), ...monthly.find(row => row._id === currentMonth), month: currentMonth },
    tasks: tasks.map(t => {
      const totals = costs.get(String(t._id)) || emptyTotals();
      return { ...t, costCny: totals.costCny, costUsd: totals.costUsd, requests: totals.requests, unpricedRequests: totals.unpricedRequests };
    }),
  };
}
const diagnosticName = value => typeof value === 'string' && /^[\w.:-]{1,100}$/.test(value) ? value : null;
export function sanitizeEvent(event) {
  return { id: String(event._id), taskId: String(event.taskId), seq: event.seq, type: diagnosticName(event.type), createdAt: event.createdAt,
    tool: diagnosticName(event.data?.name) || diagnosticName(event.data?.toolName) || diagnosticName(event.data?.tool),
    status: typeof event.data?.success === 'boolean' ? (event.data.success ? 'done' : 'failed') : diagnosticName(event.data?.status), code: diagnosticName(event.data?.code),
    failureReason: typeof event.data?.safeFailureReason === 'string' ? event.data.safeFailureReason : null,
    ...(Number.isFinite(event.data?.durationMs) ? { durationMs: event.data.durationMs } : {}),
    ...(Number.isFinite(event.data?.costCny) ? { costCny: event.data.costCny } : {}),
  };
}
export async function toolLogs(userId, params, max = 200) {
  const filter = dateFilter(params); let taskIds;
  if (filter.model) taskIds = (await WorkbenchTask.find({ userId, model: filter.model }).select('_id').lean()).map(t => t._id);
  const events = await WorkbenchTaskEvent.find({ userId, createdAt: filter.createdAt, ...(filter.taskId ? { taskId: filter.taskId } : taskIds ? { taskId: { $in: taskIds } } : {}) }).sort({ createdAt: -1 }).limit(max).lean();
  return events.map(sanitizeEvent);
}
export async function storageSummary(userId) {
  const [files, refs, assets, backups] = await Promise.all([StoredFile.find({ userId }).sort({ createdAt: -1 }), referencedFileIds(userId), SkillAsset.aggregate([{ $match: { userId: new mongoose.Types.ObjectId(userId) } }, { $group: { _id: null, bytes: { $sum: '$size' }, count: { $sum: 1 } } }]), BackupJob.find({ userId, type: 'backup', status: 'completed' }).select('_id').lean()]);
  const groups = {};
  for (const file of files) { if (!groups[file.category]) groups[file.category] = { category: file.category, bytes: 0, count: 0 }; groups[file.category].bytes += file.size; groups[file.category].count++; }
  let backupBytes = 0; for (const job of backups) backupBytes += (await stat(path.join(getStorageRoot(), 'backups', String(userId), `${job._id}.vxb`))).size;
  return { totalBytes: files.reduce((sum, f) => sum+f.size, 0) + (assets[0]?.bytes || 0) + backupBytes, categories: Object.values(groups), skillAssets: { bytes: assets[0]?.bytes || 0, count: assets[0]?.count || 0 }, backups: { bytes: backupBytes, count: backups.length }, cleanupCandidates: files.filter(f => ['library','temporary'].includes(f.ownerType) && !refs.has(f.fileId) && f.kind !== 'audio-source').map(fileMetadata) };
}
export async function cleanupStorage(userId, ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some(id => typeof id !== 'string')) throw workbenchError('请选择要清理的文件');
  const refs = await referencedFileIds(userId), files = await StoredFile.find({ userId, fileId: { $in: [...new Set(ids)] } });
  if (files.length !== new Set(ids).size) throw workbenchError('文件不存在', 404);
  if (files.some(f => !['library','temporary'].includes(f.ownerType) || f.kind === 'audio-source' || refs.has(f.fileId))) throw workbenchError('所选文件正在被使用，请先移除对应引用', 409);
  await assertFilesDeletable(userId, files);
  const bytes = files.reduce((sum, file) => sum + file.size, 0); for (const file of files) await deleteStoredFileDocument(file); return { deleted: files.length, bytes };
}
