import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
const { default: CreditTransaction } = await import('../../models/CreditTransaction.js');
import { currentMonthUsage, dateFilter, usageSummary, sanitizeEvent } from '../../lib/server/usage/service.js';

let database;
test.before(async () => {
  database = await MongoMemoryServer.create();
  await mongoose.connect(database.getUri());
});
test.after(async () => {
  await mongoose.disconnect();
  await database.stop();
});

test('Shanghai natural months have exact UTC boundaries and reject impossible dates', () => {
  const february = dateFilter(new URLSearchParams({ month: '2024-02' }));
  assert.equal(february.createdAt.$gte.toISOString(), '2024-01-31T16:00:00.000Z');
  assert.equal(february.createdAt.$lt.toISOString(), '2024-02-29T16:00:00.000Z');
  assert.equal(february.end, '2024-02-29');
  assert.throws(() => dateFilter(new URLSearchParams({ month: '2024-13' })), /有效月份/);
  assert.throws(() => dateFilter(new URLSearchParams({ start: '2024-02-30' })), /有效日期/);
  const current = dateFilter(new URLSearchParams());
  assert.equal(current.start.slice(-2), '01');
  assert.equal(current.month, new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7));
});

test('cost history uses actual amounts, isolates owners and retains prior months', async () => {
  const userId = new mongoose.Types.ObjectId(), other = new mongoose.Types.ObjectId();
  const current = dateFilter(new URLSearchParams());
  const rows = [
    { operationId: 'before-midnight', createdAt: new Date('2024-01-31T15:59:59Z'), actualCostCny: 2, actualCostUsd: 0.25 },
    { operationId: 'at-midnight', createdAt: new Date('2024-01-31T16:00:00Z'), actualCostCny: 3, actualCostUsd: 0.4 },
    { operationId: 'missing-amount', createdAt: new Date('2024-02-15T00:00:00Z'), charged: 999999, status: 'review_required' },
    { operationId: 'other-owner', createdAt: new Date('2024-02-15T00:00:00Z'), userId: other, actualCostCny: 500 },
    { operationId: 'current-month', createdAt: current.createdAt.$gte, actualCostCny: 8 },
  ];
  await CreditTransaction.create(rows.map(row => ({ userId, auditUserKey: 'cost-test', type: 'model_usage', status: 'settled', model: 'test-model', ...row })));
  await CreditTransaction.collection.insertOne({ userId, operationId: 'legacy-grant', type: 'registration_grant', status: 'settled', createdAt: new Date('2024-02-15T00:00:00Z'), actualCostCny: 100 });
  const result = await usageSummary(String(userId), new URLSearchParams({ month: '2024-02' }));
  assert.equal(result.summary.costCny, 3);
  assert.equal(result.summary.costUsd, 0.4);
  assert.equal(result.summary.requests, 2);
  assert.equal(result.summary.unpricedRequests, 1);
  assert.equal(result.summary.points, undefined);
  assert.equal(result.daily[0]._id, '2024-02-01');
  assert.equal(result.models[0].costCny, 3);
  assert.equal(result.monthly.find(row => row._id === '2024-01').costCny, 2);
  assert.equal(result.currentMonth.costCny, 8);
  const filtered = await usageSummary(String(userId), new URLSearchParams({ month: '2024-02', model: 'absent' }));
  assert.equal(filtered.summary.costCny, 0);
  assert.equal(filtered.currentMonth.costCny, 8);
  assert.equal(filtered.monthly.length, result.monthly.length);
});

test('diagnostics expose recorded money without legacy points or private payloads', () => {
  const result = sanitizeEvent({ _id: 'event', taskId: 'task', data: { costCny: 0.2, chargedPoints: 123, password: 'private' } });
  assert.equal(result.costCny, 0.2);
  assert.equal(result.chargedPoints, undefined);
  assert.equal(JSON.stringify(result).includes('private'), false);
});

test('current month totals include only the owner’s recorded costs within Shanghai month boundaries', async () => {
  const userId = new mongoose.Types.ObjectId(), other = new mongoose.Types.ObjectId();
  const { month, createdAt } = dateFilter(new URLSearchParams());
  const base = { userId, auditUserKey: 'month-test', type: 'model_usage', status: 'settled', createdAt: createdAt.$gte };
  await CreditTransaction.create([
    { ...base, operationId: 'month-start', actualCostCny: 1.25, actualCostUsd: 0.1 },
    { ...base, operationId: 'month-end', createdAt: new Date(createdAt.$lt.getTime() - 1), actualCostCny: 2.75, actualCostUsd: 0.3 },
    { ...base, operationId: 'month-unpriced', status: 'review_required' },
    { ...base, operationId: 'month-other', userId: other, actualCostCny: 800 },
    { ...base, operationId: 'month-before', createdAt: new Date(createdAt.$gte.getTime() - 1), actualCostCny: 100 },
    { ...base, operationId: 'month-after', createdAt: createdAt.$lt, actualCostCny: 200 },
    ...['pending', 'reserved', 'settling', 'released', 'rejected'].map(status => ({ ...base, operationId: `month-${status}`, status, actualCostCny: 500 })),
  ]);
  assert.deepEqual(await currentMonthUsage(String(userId)), { month, costCny: 4, costUsd: 0.4, requests: 3, unpricedRequests: 1 });
  assert.deepEqual(await currentMonthUsage(String(new mongoose.Types.ObjectId())), { month, costCny: 0, costUsd: 0, requests: 0, unpricedRequests: 0 });
  const summary = await usageSummary(String(userId), new URLSearchParams());
  assert.equal(summary.currentMonth.costCny, 4);
  assert.equal(summary.currentMonth.unpricedRequests, 1);
});
