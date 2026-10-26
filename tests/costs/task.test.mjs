import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create();
process.env.MONGO_URI = mongo.getUri();
process.env.APP_SECRETS_KEY = Buffer.alloc(32, 9).toString('base64');
delete process.env.OPENROUTER_API_KEY;
delete process.env.FISH_API_KEY;
const { createTaskBilling } = await import('../../lib/server/workbench/taskBilling.js');
const { default: User } = await import('../../models/User.js');
const { default: Task } = await import('../../models/WorkbenchTask.js');
const { default: Event } = await import('../../models/WorkbenchTaskEvent.js');
const { default: Conversation } = await import('../../models/Conversation.js');
const { appendTaskEvent } = await import('../../lib/server/workbench/events.js');
const { default: Transaction, ensureCreditTransactionIndexes } = await import('../../models/CreditTransaction.js');
const {default:dbConnect}=await import('../../lib/db.js');
await dbConnect();
const { saveAdminModelSettings } = await import('../../lib/server/models/service.js');
const { DEFAULT_MODEL_SETTINGS } = await import('../../lib/server/models/config.js');
await saveAdminModelSettings({ ...DEFAULT_MODEL_SETTINGS, baseUrl: 'https://models.example.com/v1', modelId: 'deepseek-flash', apiKey: 'cost-test-only-key', contextWindow: 1048576, maxOutputTokens: 393216, pricing: { inputPerMillion: .3, cachedInputPerMillion: .006, outputPerMillion: 1.2 } }, new mongoose.Types.ObjectId());
await ensureCreditTransactionIndexes();
test.after(async () => { await mongoose.disconnect(); await mongo.stop(); });

test('任务逐轮累加实际花费并保留上下文限制', async () => {
  const user = await User.create({ email: 'task-cost@example.com', password: 'test-only' });
  const conversation = await Conversation.create({ userId: user._id, messages: [{ id: 'model-message', role: 'model', content: '' }] });
  const task = await Task.create({
    userId: user._id, requestId: 'cost-task', fingerprint: 'cost-task-fingerprint',
    conversationId: conversation._id, userMessageId: 'user-message', modelMessageId: 'model-message',
    model: 'deepseek-flash', status: 'running',
  });
  const billing = await createTaskBilling(task, new AbortController().signal);
  const output = await billing.resolveMaxOutputTokens({ pass: 0, inputPayload: 'hi' });
  assert.equal(output, 393216);
  assert.equal(await billing.resolveMaxOutputTokens({ pass: 0, inputPayload: 'hi' }), 393216);
  assert.equal(await Transaction.countDocuments({ userId: user._id }), 1);
  await billing.onUpstreamRequest();
  billing.onUpstreamId('upstream-first');
  await billing.onPassComplete({ completion: { usageRecord: { created: Date.parse('2026-10-23T02:00:00Z') / 1000, usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 2000, cost:5000 } } } });
  let stored = await Task.findById(task._id).lean();
  assert.ok(Math.abs(stored.costCny - 0.018144) < 1e-12);
  assert.equal(stored.activeOperationId, null);
  const first = await Transaction.findOne({ operationId: `workbench:${task._id}:0` }).lean();
  assert.equal(first.status, 'settled');
  assert.ok(Math.abs(first.actualCostUsd - 0.0027) < 1e-12);
  assert.ok(Math.abs(first.actualCostCny - 0.018144) < 1e-12);
  assert.equal(first.pricingSnapshot.usdToCny, 6.72);
  assert.equal(first.usage.taskId, String(task._id));
  assert.deepEqual(first.upstreamRequestIds, ['upstream-first']);

  assert.equal(await billing.resolveMaxOutputTokens({ pass: 1, inputPayload: 'x'.repeat(3127726) }), 6000);
  await billing.onUpstreamRequest();
  await billing.onPassComplete({ completion: { usageRecord: { created: Date.parse('2026-10-23T02:00:00Z') / 1000, usage: { input_tokens: 500, input_tokens_details: { cached_tokens: 0 }, output_tokens: 1000, cost:2500 } } } });
  stored = await Task.findById(task._id).lean();
  assert.ok(Math.abs(stored.costCny - 0.027216) < 1e-12);
  assert.equal(await Transaction.countDocuments({ userId: user._id, status: 'settled' }), 2);
  const billingEvents = await Event.find({ taskId: task._id, type: 'billing' }).sort({ seq: 1 }).lean();
  assert.ok(Math.abs(billingEvents[0].data.costCny - 0.018144) < 1e-12);
  assert.ok(Math.abs(billingEvents[1].data.costCny - 0.009072) < 1e-12);
  await appendTaskEvent(task, 'completed', '执行完成');
  const saved = await Conversation.findById(conversation._id).lean();
  assert.deepEqual(saved.messages[0].thinkingTimeline.map(step => step.eventType), ['model', 'model', 'completed']);
  await assert.rejects(billing.onPassComplete({ completion: { usageRecord: { created: Date.parse('2026-10-23T02:00:00Z') / 1000, usage: { input_tokens: 1, output_tokens: 1 } } } }), /记录不存在/);
  assert.ok(Math.abs((await Task.findById(task._id)).costCny - 0.027216) < 1e-12);
  await assert.rejects(billing.resolveMaxOutputTokens({ pass: 2, inputPayload: 'x'.repeat(3145726) }), /资料过多/);
  assert.equal(await Transaction.countDocuments({ userId: user._id }), 2);
  assert.equal(Object.hasOwn(await User.collection.findOne({ _id: user._id }), 'creditBalance'), false);
});

test('主助手与子助手复用计费时每次请求独立入账，并固定任务开始时的模型费率', async () => {
  const { getManagedModel } = await import('../../lib/server/models/service.js');
  const capturedModel = await getManagedModel();
  const user = await User.create({ email: 'delegate-cost@example.com', password: 'test-only' });
  const conversation = await Conversation.create({ userId: user._id, messages: [{ id: 'delegate-message', role: 'model', content: '' }] });
  const task = await Task.create({ userId: user._id, requestId: 'delegate-cost', fingerprint: 'delegate-cost-fingerprint', conversationId: conversation._id, userMessageId: 'user', modelMessageId: 'delegate-message', model: capturedModel.id, status: 'running' });
  await saveAdminModelSettings({ ...DEFAULT_MODEL_SETTINGS, baseUrl: 'https://other.example.com/v1', protocol: 'chat', modelId: 'new-model', apiKey: 'other-cost-test-only-key', pricing: { inputPerMillion: 100, cachedInputPerMillion: 50, outputPerMillion: 200 } }, user._id);
  const billing = await createTaskBilling(task, new AbortController().signal, { modelConfig: capturedModel });
  const passes = [0, 0, 1, 1];
  for (const [sequence, pass] of passes.entries()) {
    assert.equal(await billing.resolveMaxOutputTokens({ pass, inputPayload: '查询资料' }), 393216);
    await billing.onUpstreamRequest();
    billing.onUpstreamId(`request-${sequence}`);
    await billing.onPassComplete({ completion: { usageRecord: { usage: { input_tokens: 1000, output_tokens: 2000, input_tokens_details: { cached_tokens: 0 } } } } });
  }
  const records = await Transaction.find({ userId: user._id }).sort({ createdAt: 1 }).lean();
  assert.equal(records.length, 4);
  assert.deepEqual(records.map(row => row.operationId), passes.map((_, index) => `workbench:${task._id}:${index}`));
  assert.deepEqual(records.map(row => row.usage.pass), [0, 1, 2, 3]);
  assert.ok(records.every(row => row.status === 'settled' && row.model === capturedModel.id && row.pricingSnapshot.rates.chat[capturedModel.id].inputPerMillion === .3));
  assert.ok(Math.abs((await Task.findById(task._id)).costCny - .018144 * 4) < 1e-12);
  assert.equal((await Task.findById(task._id)).activeOperationId, null);
});
