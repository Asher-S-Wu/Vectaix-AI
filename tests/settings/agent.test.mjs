import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { validatePlan, contextBudget } from '../../lib/server/workbench/plan.mjs';

test('执行计划验证步骤编号和单个进行中步骤，上下文保留继续执行空间', () => {
  assert.throws(() => validatePlan([{ id: 'a', title: '查资料', status: 'in_progress' }, { id: 'b', title: '写报告', status: 'in_progress' }]), /一个/);
  assert.throws(() => validatePlan([{ id: 'a', title: '', status: 'pending' }]), /标题/);
  assert.ok(contextBudget({ contextWindow: 128000, maxOutputTokens: 120000 }) > 80000);
});

test('Agent 的计划变更持久化并发出事件，整理上下文后保持目标，取消后停止工具', async () => {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  const { default: dbConnect } = await import('../../lib/db.js');
  await dbConnect();
  try {
    const { default: Task } = await import('../../models/WorkbenchTask.js');
    const { default: Event } = await import('../../models/WorkbenchTaskEvent.js');
    const { createTaskTools } = await import('../../lib/server/workbench/tools.js');
    const task = await Task.create({ userId: new mongoose.Types.ObjectId(), conversationId: new mongoose.Types.ObjectId(), requestId: 'plan', fingerprint: 'plan', userMessageId: 'user', modelMessageId: 'assistant', prompt: '调查并制作报告', model: 'test', status: 'running', webSearch: { enabled: false } });
    const controller = new AbortController();
    const registry = await createTaskTools(task, controller.signal, async () => controller.signal.throwIfAborted(), { provider: 'responses', nativeInputs: ['text'], contextWindow: 128000, maxOutputTokens: 8192 });
    const names = registry.definitions().map(tool => tool.name);
    assert.ok(names.includes('update_plan'));
    assert.ok(!names.includes('read_memory') && !names.includes('save_memory') && !names.includes('search_web'));
    const plan = [{ id: 'research', title: '核实资料', status: 'in_progress' }, { id: 'report', title: '交付报告', status: 'pending' }];
    await registry.execute({ id: 'call-plan', name: 'update_plan', arguments: JSON.stringify({ steps: plan }) });
    assert.equal((await Task.findById(task._id)).plan[0].status, 'in_progress');
    assert.deepEqual((await Event.findOne({ taskId: task._id, type: 'plan' }).lean()).data.plan, plan);
    await registry.execute({ id: 'call-progress', name: 'save_progress', arguments: JSON.stringify({ summary: '已找到两份资料，接下来核实并写报告。' }) });
    const messages = await registry.prepareMessages([{ role: 'user', content: '很长的旧资料' }]);
    assert.match(messages[0].content, /调查并制作报告/);
    assert.match(messages[0].content, /两份资料/);
    controller.abort(new Error('用户停止'));
    await assert.rejects(registry.execute({ id: 'stopped', name: 'update_plan', arguments: JSON.stringify({ steps: plan }) }), /用户停止/);
    assert.equal(await Event.countDocuments({ taskId: task._id, type: 'plan' }), 1);
  } finally { await mongoose.disconnect(); await mongo.stop(); }
});
