import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

const mongo = await MongoMemoryServer.create();
process.env.MONGO_URI = mongo.getUri();
process.env.APP_SECRETS_KEY = Buffer.alloc(32, 8).toString('base64');
const service = await import('../../lib/server/models/service.js');
const { DEFAULT_MODEL_SETTINGS } = await import('../../lib/server/models/config.js');
const { default: PlatformSettings } = await import('../../models/PlatformSettings.js');
const userId = new mongoose.Types.ObjectId();
const settings = { ...DEFAULT_MODEL_SETTINGS, baseUrl: 'https://models.example.com/v1', modelId: 'huajuan-agent', displayName: '花卷', apiKey: 'admin-secret-key', pricing: { inputPerMillion: 1, cachedInputPerMillion: .2, outputPerMillion: 3 } };
test.after(async () => { await mongoose.disconnect(); await mongo.stop(); });

test('未设置模型时目录为空，执行任务明确要求管理员设置', async () => {
  assert.deepEqual(await service.getPublicModels(), { models: [], defaultModelId: null });
  assert.deepEqual(await service.getManagedChatRates(), {});
  await assert.rejects(service.getManagedModel(), error => error.status === 503);
  await assert.rejects(service.getModelConnection(), error => error.status === 503);
});

test('管理员设置持久化并全局生效，密钥加密且从全部公开响应剥离', async () => {
  const saved = await service.saveAdminModelSettings(settings, userId);
  assert.equal(saved.config.hasApiKey, true);
  const raw = await PlatformSettings.findById('platform').lean();
  assert.ok(raw.modelConfig.encryptedApiKey.data);
  assert.ok(!JSON.stringify(raw).includes(settings.apiKey));
  const connection = await service.getModelConnection();
  assert.equal(connection.provider.apiKey, settings.apiKey);
  assert.equal(connection.model.id, settings.modelId);
  assert.equal(connection.provider.protocol, 'responses');
  assert.equal(connection.model.name, '花卷');
  const publicModels = await service.getPublicModels();
  assert.equal(publicModels.models.length, 1);
  assert.equal(publicModels.models[0].baseUrl, undefined);
  assert.equal(publicModels.models[0].requestOptions, undefined);
  for (const response of [saved, publicModels, await service.getAdminModelSettings()]) assert.doesNotMatch(JSON.stringify(response), /admin-secret-key|encryptedApiKey|"iv"|"tag"/);
  assert.equal((await service.getManagedChatRates())[settings.modelId].outputPerMillion, 3);
  await assert.rejects(service.getManagedModel('other-model'), /已停用/);
});

test('保持同一服务时空 key 保留原值，改地址时必须重新输入凭据', async () => {
  await service.saveAdminModelSettings({ ...settings, apiKey: '', displayName: '新名字' }, userId);
  assert.equal((await service.getModelConnection()).provider.apiKey, settings.apiKey);
  await assert.rejects(service.saveAdminModelSettings({ ...settings, baseUrl: 'https://other.example.com/v1', apiKey: '' }, userId), /重新输入/);
  await assert.rejects(service.discoverModels({ baseUrl: 'https://other.example.com/v1', protocol: 'responses' }), /先输入/);
  await service.saveAdminModelSettings({ ...settings, apiKey: '', clearApiKey: true }, userId);
  assert.equal((await service.getAdminModelSettings()).config.hasApiKey, false);
  await assert.rejects(service.getModelConnection(), error => error.status === 503);
});

test('模型地址规范化和参数检查', () => {
  assert.equal(service.normalizeModelBaseUrl('https://api.example.com'), 'https://api.example.com/v1');
  assert.equal(service.normalizeModelBaseUrl('https://api.example.com/custom/chat/completions'), 'https://api.example.com/custom');
  for (const baseUrl of ['file:///tmp/a', 'http://example.com', 'https://user:key@example.com', 'https://example.com?key=secret']) assert.throws(() => service.normalizeModelBaseUrl(baseUrl));
  for (const patch of [{ protocol: 'auto' }, { modelId: '../bad model' }, { maxOutputTokens: 128000 }, { pricing: { inputPerMillion: -1 } }, { nativeInputs: ['audio'] }]) assert.throws(() => service.validateModelSettings({ ...settings, ...patch }));
});

test('按指定协议获取模型列表，Message完整分页且凭据仅发到指定地址', async () => {
  const calls = [];
  const result = await service.discoverModels({ baseUrl: 'https://models.example.com', protocol: 'messages', apiKey: 'discover-key' }, { fetchImpl: async (url, init) => {
    calls.push({ url: String(url), headers: init.headers });
    return Response.json(calls.length === 1 ? { data: [{ id: 'z', display_name: 'Z模型' }], has_more: true, last_id: 'z' } : { data: [{ id: 'a', display_name: 'A模型' }], has_more: false });
  } });
  assert.deepEqual(result.models, [{ id: 'a', name: 'A模型' }, { id: 'z', name: 'Z模型' }]);
  assert.equal(calls[0].url, 'https://models.example.com/v1/models?limit=1000');
  assert.equal(calls[1].url, 'https://models.example.com/v1/models?limit=1000&after_id=z');
  assert.equal(calls[0].headers['x-api-key'], 'discover-key');
  let count = 0;
  await assert.rejects(service.discoverModels({ baseUrl: settings.baseUrl, protocol: 'chat', apiKey: 'private-key' }, { fetchImpl: async () => { count++; return Response.json({ error: 'private-key' }, { status: 401 }); } }), error => !error.message.includes('private-key') && /验证失败/.test(error.message));
  assert.equal(count, 1);
});
