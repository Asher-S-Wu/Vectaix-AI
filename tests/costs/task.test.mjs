import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create();
process.env.MONGO_URI = mongo.getUri();
process.env.APP_SECRETS_KEY = Buffer.alloc(32, 9).toString('base64');
delete process.env.OPENROUTER_API_KEY;
delete process.env.DASHSCOPE_SINGAPORE_API_KEY;
const { createTaskBilling } = await import('../../lib/server/workbench/taskBilling.js');
const { default: User } = await import('../../models/User.js');
const { default: Task } = await import('../../models/WorkbenchTask.js');
const { default: Event } = await import('../../models/WorkbenchTaskEvent.js');
const { default: Transaction, ensureCreditTransactionIndexes } = await import('../../models/CreditTransaction.js');
const {default:dbConnect}=await import('../../lib/db.js');
await dbConnect();
await ensureCreditTransactionIndexes();
test.after(async () => { await mongoose.disconnect(); await mongo.stop(); });

test('高单价模型不限制普通用户输出，逐轮累加实际花费并保留上下文限制', async () => {
  const user = await User.create({ email: 'task-cost@example.com', password: 'test-only' });
  const task = await Task.create({
    userId: user._id, requestId: 'cost-task', fingerprint: 'cost-task-fingerprint',
    conversationId: new mongoose.Types.ObjectId(), userMessageId: 'user-message', modelMessageId: 'model-message',
    model: 'gpt-6-astra', status: 'running',
  });
  const billing = await createTaskBilling(task, new AbortController().signal);
  const output = await billing.resolveMaxOutputTokens({ pass: 0, inputPayload: 'hi' });
  assert.equal(output, 8192);
  assert.equal(await billing.resolveMaxOutputTokens({ pass: 0, inputPayload: 'hi' }), 8192);
  assert.equal(await Transaction.countDocuments({ userId: user._id }), 1);
  await billing.onUpstreamRequest();
  billing.onUpstreamId('upstream-first');
  await billing.onPassComplete({ completion: { usageRecord: { usage: { input_tokens: 1000, output_tokens: 2000, cost:5000 } } } });
  let stored = await Task.findById(task._id).lean();
  assert.equal(stored.costCny, 33600);
  assert.equal(stored.activeOperationId, null);
  const first = await Transaction.findOne({ operationId: `workbench:${task._id}:0` }).lean();
  assert.equal(first.status, 'settled');
  assert.equal(first.actualCostUsd, 5000);
  assert.equal(first.actualCostCny, 33600);
  assert.equal(first.pricingSnapshot.usdToCny, 6.72);
  assert.equal(first.usage.taskId, String(task._id));
  assert.deepEqual(first.upstreamRequestIds, ['upstream-first']);

  assert.equal(await billing.resolveMaxOutputTokens({ pass: 1, inputPayload: 'x'.repeat(2981998) }), 6000);
  await billing.onUpstreamRequest();
  await billing.onPassComplete({ completion: { usageRecord: { usage: { input_tokens: 500, output_tokens: 1000, cost:2500 } } } });
  stored = await Task.findById(task._id).lean();
  assert.equal(stored.costCny, 50400);
  assert.equal(await Transaction.countDocuments({ userId: user._id, status: 'settled' }), 2);
  const billingEvents = await Event.find({ taskId: task._id, type: 'billing' }).sort({ seq: 1 }).lean();
  assert.deepEqual(billingEvents.map(event => event.data.costCny), [33600, 16800]);
  await assert.rejects(billing.onPassComplete({ completion: { usageRecord: { usage: { input_tokens: 1, output_tokens: 1 } } } }), /记录不存在/);
  assert.equal((await Task.findById(task._id)).costCny, 50400);
  await assert.rejects(billing.resolveMaxOutputTokens({ pass: 2, inputPayload: 'x'.repeat(2999998) }), /上下文/);
  assert.equal(await Transaction.countDocuments({ userId: user._id }), 2);
  assert.equal(Object.hasOwn(await User.collection.findOne({ _id: user._id }), 'creditBalance'), false);
});
