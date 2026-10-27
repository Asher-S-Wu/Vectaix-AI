import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create();
process.env.MONGO_URI = mongo.getUri();
process.env.APP_SECRETS_KEY = Buffer.alloc(32, 19).toString('base64');
process.env.DEEPSEEK_API_KEY = 'test-existing-model-key';
process.env.MICU_OPENAI_IMAGE_API_KEY = 'test-existing-image-key';
process.env.ELEVENLABS_API_KEY = 'test-existing-audio-key';

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
  for (const [kind, key] of [['image', process.env.MICU_OPENAI_IMAGE_API_KEY], ['audio', process.env.ELEVENLABS_API_KEY]]) {
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
  assert.equal(decryptSecret(media.audio.encryptedApiKey, 'media:audio'), process.env.ELEVENLABS_API_KEY);
});


test('已完成旧密钥导入的站点切换为 ElevenLabs，清除旧服务设置且保留图片配置', async () => {
  const image = { ...DEFAULT_MEDIA_SETTINGS.image, size: '2048x1152' };
  await MediaSettings.create({ _id: 'media', image, audio: { provider: 'fish', voiceId: 'old-voice', encryptedApiKey: encryptSecret('old-fish-key', 'media:audio') } });
  await MediaSettings.collection.updateOne({ _id: 'media' }, { $set: { qwenAudio: { enabled: true }, audioProvider: 'qwen' } });
  await mongoose.connection.collection('settings_migrations').insertOne({ _id: 'huajuan-service-credentials-v1' });
  await migrateServiceCredentials();
  const stored = await MediaSettings.findById('media').lean();
  assert.deepEqual(stored.image, image);
  assert.equal(stored.audio.provider, 'elevenlabs');
  assert.equal(stored.audio.voiceId, '');
  assert.equal(decryptSecret(stored.audio.encryptedApiKey, 'media:audio'), process.env.ELEVENLABS_API_KEY);
  assert.equal(stored.qwenAudio, undefined);
  assert.equal(stored.audioProvider, undefined);
});

test('切换期间缺少 ElevenLabs 密钥时保存停用状态，旧密钥留在旧服务', async () => {
  const key = process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  try {
    await MediaSettings.create({ _id: 'media', audio: { provider: 'fish', enabled: true, encryptedApiKey: encryptSecret('old-fish-key', 'media:audio') } });
    await migrateServiceCredentials();
    const { audio } = await getMediaSettings();
    assert.equal(audio.provider, 'elevenlabs');
    assert.equal(audio.enabled, false);
    assert.equal(audio.hasApiKey, false);
  } finally { process.env.ELEVENLABS_API_KEY = key; }
});


test('切换服务后旧语音文件可在文件管理中删除，文件内容与现有 ElevenLabs 作品归属保留', async () => {
  const files = mongoose.connection.collection('storedfiles');
  const oldRecords = mongoose.connection.collection('fishaudiogenerations');
  const userId = new mongoose.Types.ObjectId();
  await oldRecords.insertOne({ generationId: 'old-generation', audioFileId: 'old-audio-file', userId });
  await files.insertMany([
    { fileId: 'old-audio-file', userId, ownerType: 'audio-generation', ownerId: 'old-generation', kind: 'media-audio', storageKey: 'existing/path.mp3' },
    { fileId: 'new-audio-file', userId, ownerType: 'audio-generation', ownerId: 'elevenlabs-generation', kind: 'media-audio' },
  ]);
  await migrateServiceCredentials();
  const oldFile = await files.findOne({ fileId: 'old-audio-file' });
  assert.equal(oldFile.ownerType, 'library');
  assert.equal(oldFile.kind, 'library');
  assert.equal(oldFile.ownerId, null);
  assert.equal(oldFile.storageKey, 'existing/path.mp3');
  assert.equal((await files.findOne({ fileId: 'new-audio-file' })).ownerType, 'audio-generation');
  await files.deleteMany({ userId });
  await oldRecords.deleteMany({ userId });
});
