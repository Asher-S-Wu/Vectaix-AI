import test from 'node:test';
import assert from 'node:assert/strict';

test('设置只接受受支持的权限与助手字段', async () => {
  const { validatePreferences } = await import('../../lib/shared/preferences.mjs');
  assert.deepEqual(validatePreferences({ permissions: { browser: true, notifications: false } }), { permissions: { browser: true, notifications: false } });
  assert.throws(() => validatePreferences({ permissions: { browser: 'yes' } }));
  assert.throws(() => validatePreferences({ permissions: { shell: true } }));
  assert.throws(() => validatePreferences({ assistant: { language: 'wrong' } }));
  assert.throws(() => validatePreferences({ appearance: { completionSoundVolume: 101 } }));
});

test('个性说明不会覆盖当前用户要求，SOUL导出导入保留内容', async () => {
  const { formatSoul, parseSoul, assistantPrompt } = await import('../../lib/shared/preferences.mjs');
  const value = { name: '小助手', language: 'zh', style: '简洁', instructions: '先列来源\n再给结论', avatarFileId: null };
  assert.deepEqual(parseSoul(formatSoul(value)), value);
  assert.match(assistantPrompt(value), /当前用户/);
  assert.match(assistantPrompt(value), /先列来源/);
});

test('权限迁移直接清理旧数据并保留当前权限', async () => {
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const { default: mongoose } = await import('mongoose');
  const mongo = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongo.getUri());
    const { migrateUserCapabilities } = await import('../../lib/server/settings/migration.js');
    const settings = mongoose.connection.collection('usersettings');
    const migrations = mongoose.connection.collection('settings_migrations');
    await migrations.insertOne({ _id: 'capabilities-v1', completedAt: new Date() });
    const { insertedId } = await settings.insertOne({ userId: new mongoose.Types.ObjectId(), permissions: { microphone: true, camera: true, clipboard: true, geolocation: true, browser: true, notifications: false } });
    await migrateUserCapabilities();
    await migrateUserCapabilities();
    assert.deepEqual((await settings.findOne({ _id: insertedId })).permissions, { browser: true, notifications: false });
    assert.equal(await migrations.countDocuments({ _id: 'permissions-v2' }), 1);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
