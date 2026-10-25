import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { mkdtemp, rm } from 'node:fs/promises';
import dns from 'node:dns/promises';
import { syncBuiltinESMExports } from 'node:module';
import undici from 'undici';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

function completedResponse(index, output, text) {
  const response = { id: `response-${index}`, status: 'completed', created_at: 1792720800, output, usage: { input_tokens: 1000, output_tokens: 200, input_tokens_details: { cached_tokens: 100 } } };
  const events = [...(text ? [{ type: 'response.output_text.delta', delta: text }] : []), { type: 'response.completed', response }];
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}
const functionCall = (id, name, args) => ({ type: 'function_call', id: `function-${id}`, call_id: id, name, arguments: JSON.stringify(args) });
const reply = (id, text) => ({ type: 'message', id: `message-${id}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] });

test('真实任务队列完成计划、只读子助手与交付，六次模型请求分别结算并同步对话', { timeout: 30000 }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'huajuan-runner-'));
  const database = await MongoMemoryServer.create();
  process.env.MONGO_URI = database.getUri();
  process.env.STORAGE_ROOT = directory;
  process.env.APP_SECRETS_KEY = Buffer.alloc(32, 4).toString('base64');
  const requests = [], lookedUp = [];
  t.mock.method(dns, 'lookup', async hostname => {
    assert.equal(hostname, 'models.example.com', '仅允许固定模型测试地址');
    lookedUp.push(hostname);
    return [{ address: '93.184.216.34', family: 4 }];
  });
  syncBuiltinESMExports();
  const planned = [{ id: 'research', title: '核对对话资料', status: 'in_progress' }, { id: 'delivery', title: '汇总核对结果', status: 'pending' }];
  const finished = planned.map(step => ({ ...step, status: 'completed' }));
  const childAnswer = '子助手调查：当前对话没有附件。';
  const finalAnswer = '已核对当前对话资料，本次对话没有附件。';
  t.mock.method(undici, 'fetch', async (url, init) => {
    assert.equal(String(url), 'https://models.example.com/v1/responses', '测试中所有HTTP均在此截获');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer runner-test-key');
    const body = JSON.parse(init.body), index = requests.length;
    requests.push(body);
    assert.equal(body.model, 'runner-model');
    switch (index) {
      case 0: return completedResponse(index, [functionCall('plan-start', 'update_plan', { steps: planned })]);
      case 1: return completedResponse(index, [functionCall('delegate', 'delegate_research', { goal: '列出当前对话资料，确认附件数量。' })]);
      case 2: return completedResponse(index, [functionCall('child-list', 'list_documents', {})]);
      case 3: return completedResponse(index, [reply(index, childAnswer)], childAnswer);
      case 4: return completedResponse(index, [functionCall('plan-finish', 'update_plan', { steps: finished })]);
      case 5: return completedResponse(index, [reply(index, finalAnswer)], finalAnswer);
      default: throw new Error('出现了预期之外的模型请求');
    }
  });
  const { default: dbConnect } = await import('../../lib/db.js');
  const { default: User } = await import('../../models/User.js');
  const { default: Task } = await import('../../models/WorkbenchTask.js');
  const { default: Event } = await import('../../models/WorkbenchTaskEvent.js');
  const { default: Conversation } = await import('../../models/Conversation.js');
  const { default: Transaction, ensureCreditTransactionIndexes } = await import('../../models/CreditTransaction.js');
  const { saveAdminModelSettings } = await import('../../lib/server/models/service.js');
  const { DEFAULT_MODEL_SETTINGS } = await import('../../lib/server/models/config.js');
  const { createTask } = await import('../../lib/server/workbench/tasks.js');
  const state = globalThis.__vectaixWorkbench;
  try {
    await dbConnect();
    await ensureCreditTransactionIndexes();
    const user = await User.create({ email: 'runner@example.com', password: 'test-only' });
    await saveAdminModelSettings({ ...DEFAULT_MODEL_SETTINGS, baseUrl: 'https://models.example.com/v1', modelId: 'runner-model', apiKey: 'runner-test-key', pricing: { inputPerMillion: 1, cachedInputPerMillion: .2, outputPerMillion: 3 } }, user._id);
    const created = await createTask(String(user._id), { requestId: randomUUID(), prompt: '请安排子助手核对当前对话的资料，再汇总结果。' });
    const deadline = Date.now() + 15000;
    let task;
    do {
      await delay(30);
      task = await Task.findById(created.task._id).lean();
      if (['completed', 'failed', 'stopped', 'interrupted'].includes(task.status) && state.running.size === 0) break;
    } while (Date.now() < deadline);
    assert.equal(task.status, 'completed', task.error || '任务未在时限内完成');
    assert.equal(state.running.size, 0, '任务执行器已完成最终清理');
    assert.equal(requests.length, 6);
    assert.equal(lookedUp.length, 6, '每次模型请求均经过公开地址检查');
    assert.equal(task.output, finalAnswer);
    assert.equal(task.billingReviewRequired, false);
    assert.equal(task.activeOperationId, null);
    assert.deepEqual(task.plan.map(({ id, title, status }) => ({ id, title, status })), finished);

    const readonly = new Set(['list_documents', 'read_document', 'list_library', 'read_file', 'load_skill', 'read_skill_file', 'search_web', 'read_webpage', 'read_task_step', 'list_media', 'media_capabilities']);
    assert.ok(requests[0].tools.some(tool => tool.name === 'delegate_research'));
    for (const request of requests.slice(2, 4)) {
      assert.ok(request.tools.length > 0);
      assert.ok(request.tools.every(tool => readonly.has(tool.name)), '子助手只获得只读工具');
      for (const name of ['update_plan', 'delegate_research', 'create_report', 'create_table', 'edit_file', 'generate_image', 'generate_speech']) assert.ok(!request.tools.some(tool => tool.name === name), `子助手无 ${name} 权限`);
      assert.match(request.instructions, /资料调查子助手/);
    }
    const childToolOutput = requests[3].input.find(item => item.type === 'function_call_output' && item.call_id === 'child-list');
    assert.ok(childToolOutput);
    assert.deepEqual(JSON.parse(childToolOutput.output), []);
    const delegatedResult = requests[4].input.find(item => item.type === 'function_call_output' && item.call_id === 'delegate');
    assert.deepEqual(JSON.parse(delegatedResult.output), { findings: childAnswer });
    assert.ok(!requests[4].input.some(item => item.type === 'function_call' && item.call_id === 'child-list'), '子助手原生上下文独立');

    const records = await Transaction.find({ userId: user._id }).sort({ createdAt: 1 }).lean();
    assert.equal(records.length, 6);
    assert.deepEqual(records.map(record => record.operationId), Array.from({ length: 6 }, (_, index) => `workbench:${task._id}:${index}`));
    assert.deepEqual(records.map(record => record.usage.pass), [0, 1, 2, 3, 4, 5]);
    assert.ok(records.every(record => record.status === 'settled' && record.model === 'runner-model'));
    assert.ok(records.every(record => record.usage.inputTokens === 1000 && record.usage.outputTokens === 200));
    const totalCny = .00152 * 6.72 * 6;
    assert.ok(Math.abs(task.costCny - totalCny) < 1e-12);
    assert.ok(Math.abs(records.reduce((sum, record) => sum + record.actualCostCny, 0) - totalCny) < 1e-12);

    const events = await Event.find({ taskId: task._id }).sort({ seq: 1 }).lean();
    assert.deepEqual(events.filter(event => event.type === 'tool_start').map(event => event.data.tool), ['update_plan', 'delegate_research', 'list_documents', 'update_plan']);
    assert.equal(events.filter(event => event.type === 'agent_start').length, 1);
    assert.equal(events.filter(event => event.type === 'agent_complete').length, 1);
    assert.equal(events.filter(event => event.type === 'billing').length, 6);
    assert.equal(events.at(-1).type, 'completed');
    const conversation = await Conversation.findById(task.conversationId).lean();
    const message = conversation.messages.find(item => item.id === task.modelMessageId);
    assert.equal(conversation.activeTaskId, null);
    assert.equal(conversation.model, 'runner-model');
    assert.equal(message.taskStatus, 'completed');
    assert.equal(message.content, finalAnswer);
    assert.equal(message.providerState.responses.model, 'runner-model');
    assert.ok(!message.content.includes(childAnswer), '子助手输出由主助手汇总后展示');
    assert.ok(message.thinkingTimeline.some(step => step.eventType === 'agent_complete'));
    assert.ok(message.thinkingTimeline.every(step => step.status === 'done'));
  } finally {
    clearInterval(state.timer);
    for (const entry of state.running.values()) entry.controller.abort(new Error('测试结束'));
    const cleanupDeadline = Date.now() + 3000;
    while (state.running.size && Date.now() < cleanupDeadline) await delay(20);
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await database.stop();
    await rm(directory, { recursive: true, force: true });
    t.mock.restoreAll();
    syncBuiltinESMExports();
    delete globalThis.__vectaixWorkbench;
  }
});
