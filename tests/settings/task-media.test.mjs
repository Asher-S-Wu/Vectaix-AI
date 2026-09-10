import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

test('未配置创作参数的聊天任务从数据库取出后仍能注册工具', async () => {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  try {
    const { default: dbConnect } = await import('../../lib/db.js');
    await dbConnect();
    const { default: Task } = await import('../../models/WorkbenchTask.js');
    const { registerMediaTools } = await import('../../lib/server/workbench/mediaTools.js');
    const stored = await Task.create({ userId: new mongoose.Types.ObjectId(), conversationId: new mongoose.Types.ObjectId(), requestId: 'empty-media', fingerprint: 'empty-media', userMessageId: 'user', modelMessageId: 'assistant', model: 'test', mediaSettings: {} });
    const task = await Task.findById(stored._id).lean();
    const entries = [];
    await registerMediaTools({ registry: { add: entry => entries.push(entry) }, task, signal: new AbortController().signal, assertActive: async () => {} });
    const capabilities = await entries.find(entry => entry.definition.name === 'media_capabilities').execute();
    assert.ok(Object.values(capabilities).every(value => value.available === false));
    assert.ok(entries.some(entry => entry.definition.name === 'list_media'));
    assert.ok(!entries.some(entry => entry.definition.name === 'generate_speech'));
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
