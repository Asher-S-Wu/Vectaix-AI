import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

test('管理员保存沙盒后全局生效，修改时保留密钥，停用后清除密钥', async () => {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  process.env.APP_SECRETS_KEY = Buffer.alloc(32, 7).toString('base64');
  const { getAdminSandboxSettings, saveAdminSandboxSettings, getSandboxConnection } = await import('../../lib/server/sandbox/settings.js');
  const { DEFAULT_SANDBOX_SETTINGS } = await import('../../lib/server/sandbox/config.js');
  const userId = new mongoose.Types.ObjectId();
  try {
    assert.deepEqual(await getAdminSandboxSettings(), { config: { ...DEFAULT_SANDBOX_SETTINGS, hasApiKey: false } });
    assert.equal(await getSandboxConnection(), null);
    const settings = { ...DEFAULT_SANDBOX_SETTINGS, enabled: true, environmentId: '00000000-0000-4000-8000-000000000001', apiKey: 'sandbox_test_admin_key' };
    const saved = await saveAdminSandboxSettings(settings, userId);
    assert.equal(saved.config.hasApiKey, true);
    assert.equal(saved.config.apiKey, undefined);
    const { enabled: _enabled, ...connection } = settings;
    assert.deepEqual(await getSandboxConnection(), connection);
    await saveAdminSandboxSettings({ ...settings, apiKey: '', timeoutSeconds: 60 }, userId);
    assert.equal((await getSandboxConnection()).apiKey, settings.apiKey);
    assert.equal((await getSandboxConnection()).timeoutSeconds, 60);
    const cleared = await saveAdminSandboxSettings({ ...settings, enabled: false, apiKey: '', clearApiKey: true }, userId);
    assert.equal(cleared.config.hasApiKey, false);
    assert.equal(await getSandboxConnection(), null);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
