import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

test('网站启动与定时任务无需请求语音服务，健康检查返回正常', async t => {
  const database = await MongoMemoryServer.create();
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vectaix-startup-'));
  const timers = [];
  process.env.MONGO_URI = database.getUri();
  process.env.STORAGE_ROOT = directory;
  process.env.NEXT_RUNTIME = 'nodejs';
  delete process.env.ADMIN_EMAILS;
  try {
    const { default: dbConnect } = await import('../lib/db.js');
    await dbConnect();
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
    assert.equal(fetch.mock.callCount(), 0);
    assert.equal(errors.mock.callCount(), 0);
    const { GET } = await import('../app/api/health/route.js');
    const health = await GET();
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, 'ok');
  } finally {
    timers.forEach(item => clearInterval(item.timer));
    await mongoose.disconnect();
    await database.stop();
    assert.ok(directory.startsWith(path.join(os.tmpdir(), 'vectaix-startup-')));
    await rm(directory, { recursive: true, force: true });
  }
});
