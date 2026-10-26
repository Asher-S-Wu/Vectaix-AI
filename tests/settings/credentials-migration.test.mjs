import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create();
process.env.MONGO_URI = mongo.getUri();
process.env.APP_SECRETS_KEY = Buffer.alloc(32, 19).toString('base64');
process.env.DEEPSEEK_API_KEY = 'test-existing-model-key';
process.env.MICU_OPENAI_IMAGE_API_KEY = 'test-existing-image-key';
process.env.FISH_API_KEY = 'test-existing-audio-key';

const { default: dbConnect } = await import('../../lib/db.js');
const { default: PlatformSettings } = await import('../../models/PlatformSettings.js');
const { default: MediaSettings } = await import('../../models/MediaSettings.js');
const { migrateServiceCredentials } = await import('../../lib/server/settings/migration.js');
const { getAdminModelSettings, getModelConnection, saveAdminModelSettings } = await import('../../lib/server/models/service.js');
const { DEFAULT_MODEL_SETTINGS } = await import('../../lib/server/models/config.js');
const { DEFAULT_MEDIA_SETTINGS, getMediaSettings } = await import('../../lib/server/media/settings.js');
const { encryptSecret, decryptSecret } = await import('../../lib/server/security/secrets.mjs');
await dbConnect();

test.beforeEach(async () => {
  await PlatformSettings.deleteMany({});
  await MediaSettings.deleteMany({});
  await mongoose.connection.collection('settings_migrations').deleteMany({});
});
test.after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

test('已有模型和媒体环境密钥自动导入后台，重启保留后续修改和清除', async () => {
  await migrateServiceCredentials();
  const { config } = await getAdminModelSettings();
  assert.equal(config.hasApiKey, true);
  assert.equal(config.modelId, 'deepseek-flash');
  assert.equal(config.baseUrl, 'https://api.deepseek.com/v1');
  assert.equal(config.protocol, 'responses');
  assert.equal(config.contextWindow, 1048576);
  assert.equal(config.maxOutputTokens, 393216);
  assert.equal((await getModelConnection()).provider.apiKey, process.env.DEEPSEEK_API_KEY);

  const media = await MediaSettings.findById('media').lean();
  const visibleMedia = await getMediaSettings();
  assert.equal(visibleMedia.qwenAudio.baseUrl, 'https://ws-2t7yj3g991jc5yo6.ap-southeast-1.maas.aliyuncs.com');
  assert.equal(visibleMedia.qwenAudio.enabled, false);
  for (const [kind, key] of [['image', process.env.MICU_OPENAI_IMAGE_API_KEY], ['audio', process.env.FISH_API_KEY]]) {
    assert.equal(decryptSecret(media[kind].encryptedApiKey, `media:${kind}`), key);
    assert.equal(visibleMedia[kind].hasApiKey, true);
    assert.equal(visibleMedia[kind].enabled, true);
    assert.equal(visibleMedia[kind].baseUrl, DEFAULT_MEDIA_SETTINGS[kind].baseUrl);
  }

  await saveAdminModelSettings({ ...config, displayName: '管理员设置', clearApiKey: true }, new mongoose.Types.ObjectId());
  await MediaSettings.updateOne({ _id: 'media' }, {
    $set: { 'image.enabled': false, 'audio.speed': 1.25 },
    $unset: { 'image.encryptedApiKey': '' },
  });
  await migrateServiceCredentials();
  assert.equal((await getAdminModelSettings()).config.displayName, '管理员设置');
  assert.equal((await getAdminModelSettings()).config.hasApiKey, false);
  const afterRestart = await getMediaSettings();
  assert.equal(afterRestart.image.hasApiKey, false);
  assert.equal(afterRestart.image.enabled, false);
  assert.equal(afterRestart.audio.speed, 1.25);
});

test('首次导入保留已有后台配置，并导入尚未配置的媒体服务', async () => {
  const { config } = await saveAdminModelSettings({
    ...DEFAULT_MODEL_SETTINGS, baseUrl: 'https://models.example.com/v1', modelId: 'configured-model', apiKey: 'test-admin-model-key',
  }, new mongoose.Types.ObjectId());
  const image = { ...DEFAULT_MEDIA_SETTINGS.image, size: '1280x720', encryptedApiKey: encryptSecret('test-admin-image-key', 'media:image') };
  await MediaSettings.create({ _id: 'media', image });
  await migrateServiceCredentials();
  assert.deepEqual((await getAdminModelSettings()).config, config);
  assert.equal((await getModelConnection()).provider.apiKey, 'test-admin-model-key');
  const media = await MediaSettings.findById('media').lean();
  assert.deepEqual(media.image, image);
  assert.equal(decryptSecret(media.audio.encryptedApiKey, 'media:audio'), process.env.FISH_API_KEY);
});
