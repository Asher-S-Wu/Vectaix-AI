import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

test('MiniMax 查询失败时网站照常启动，后台核对保留占用并记录错误', async t => {
  const database = await MongoMemoryServer.create();
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vectaix-startup-'));
  const timers = [];
  process.env.MONGO_URI = database.getUri();
  process.env.STORAGE_ROOT = directory;
  process.env.NEXT_RUNTIME = 'nodejs';
  process.env.DASHSCOPE_BEIJING_API_KEY = 'test-key';
  delete process.env.ADMIN_EMAILS;
  try {
    const { default: dbConnect } = await import('../lib/db.js');
    await dbConnect();
    const { default: User } = await import('../models/User.js');
    const { default: Voice } = await import('../models/MinimaxVoice.js');
    const { default: Transaction } = await import('../models/CreditTransaction.js');
    const userId = (await User.create({ email: 'startup@example.test', password: 'test-only' }))._id;
    const operationId = crypto.randomUUID();
    const voice = await Voice.create({
      userId, voiceId: `test-${crypto.randomUUID()}`, displayName: '测试音色', status: 'READY',
      cloneModel: 'MiniMax/speech-2.8-turbo', demoText: '你好', consentConfirmedAt: new Date(),
      claimOperationId: operationId, claimStartedAt: new Date(Date.now() - 20 * 60 * 1000),
    });
    await Transaction.create({
      operationId, userId, auditUserKey: 'test-audit', type: 'model_usage', status: 'review_required',
      provider: 'minimax', usage: { characters: 2, firstVoiceClone: true, quality: 'turbo' },
    });
    const errors = t.mock.method(console, 'error', () => {});
    const fetch = t.mock.method(globalThis, 'fetch', async () => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('connection timed out'), { code: 'UND_ERR_CONNECT_TIMEOUT' }) });
    });
    const originalSetInterval = globalThis.setInterval;
    t.mock.method(globalThis, 'setInterval', (callback, delay, ...args) => {
      const timer = originalSetInterval(callback, delay, ...args);
      timers.push({ timer, callback, delay });
      return timer;
    });
    const { register } = await import('../instrumentation.js');
    await register();
    assert.equal(fetch.mock.callCount(), 0);
    await Promise.all(timers.filter(item => item.delay === 60 * 1000).map(item => item.callback()));
    assert.equal(fetch.mock.callCount(), 1);
    assert.ok(errors.mock.calls.some(call => call.arguments[0] === '[Costs] scheduled reconcile:'));
    const { GET } = await import('../app/api/health/route.js');
    const health = await GET();
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, 'ok');
    assert.equal((await Voice.findById(voice._id).lean()).claimOperationId, operationId);
    assert.equal((await Transaction.findOne({ operationId }).lean()).status, 'review_required');
  } finally {
    timers.forEach(item => clearInterval(item.timer));
    await mongoose.disconnect();
    await database.stop();
    assert.ok(directory.startsWith(path.join(os.tmpdir(), 'vectaix-startup-')));
    await rm(directory, { recursive: true, force: true });
  }
});
