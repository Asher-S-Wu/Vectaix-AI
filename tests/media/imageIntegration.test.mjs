import { getAgentMediaSettings, getMediaSettings, saveMediaSettings, clearSharedVoice } from '../../lib/server/media/settings.js';
const { default: MediaSettings } = await import('../../models/MediaSettings.js');
import { seedMediaSettings } from '../helpers/media-config.mjs';
import test from 'node:test';
import undici from 'undici';
import timers from 'node:timers/promises';
test.beforeEach(t => { t.mock.method(timers, 'setTimeout', async () => {}); });
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5X8AAAAASUVORK5CYII=', 'base64');
const model = 'gpt-image-2.5-sunburst';
const options = { model, size: '2048x1152', quality: 'max' };
let database, directory, userId, generateImage, editImage, Transaction, StoredFile, registerMediaTools;
let Task, TaskEvent, Conversation, readStoredFileBuffer;

test.before(async () => {
  database = await MongoMemoryServer.create();
  directory = await mkdtemp(path.join(os.tmpdir(), 'vectaix-images-'));
  process.env.MONGO_URI = database.getUri();
  process.env.STORAGE_ROOT = directory;
  process.env.MICU_OPENAI_IMAGE_API_KEY = 'test-image-key';
  const { default: dbConnect } = await import('../../lib/db.js');
  await dbConnect();
  await seedMediaSettings({imageKey: 'test-image-key'});
  const { default: User } = await import('../../models/User.js');
  userId = String((await User.create({ email: 'image@example.test', password: 'test-only' }))._id);
  ({ generateImage } = await import('../../lib/media/server/operations/image.js'));
  ({ editImage } = await import('../../lib/media/server/operations/imageEdit.js'));
  ({ default: Transaction } = await import('../../models/CreditTransaction.js'));
  ({ default: StoredFile } = await import('../../models/StoredFile.js'));
  ({ registerMediaTools } = await import('../../lib/server/workbench/mediaTools.js'));
  ({ default: Task } = await import('../../models/WorkbenchTask.js'));
  ({ default: TaskEvent } = await import('../../models/WorkbenchTaskEvent.js'));
  ({ default: Conversation } = await import('../../models/Conversation.js'));
  ({ readStoredFileBuffer } = await import('../../lib/server/storage/service.js'));
});
test.after(async () => {
  await mongoose.disconnect();
  await database?.stop();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('Micu 生成忽略旧画质并保存真实文件，按实际用量计费，同一操作不再次调用', async t => {
  let requests = 0;
  t.mock.method(undici, 'fetch', async (url, init) => {
    requests++;
    assert.equal(String(url), 'https://www.micuapi.ai/v1/images/generations');
    assert.equal(JSON.parse(init.body).model, model);
    assert.equal(JSON.parse(init.body).quality, 'low');
    return Response.json({ data: [{ b64_json: png.toString('base64') }], usage: { input_tokens: 150, input_tokens_details: { text_tokens: 100, image_tokens: 50 }, output_tokens: 200, total_tokens: 350 } }, { headers: { 'x-request-id': 'micu-generated' } });
  });
  const clientOperationId = crypto.randomUUID();
  const input = { userId, body: { ...options, prompt: '蓝色花瓶' }, clientOperationId };
  const result = await generateImage(input);
  assert.equal(result.status, 200);
  assert.equal(result.data.success, true);
  assert.match(result.data.results[0].url, /^\/api\/files\//);
  const record = await Transaction.findOne({ model }).lean();
  assert.equal(record.provider, 'micu');
  assert.equal(record.status, 'settled');
  assert.ok(Math.abs(record.actualCostUsd - 0.0069) < 1e-12);
  assert.ok(Math.abs(record.actualCostCny - 0.046368) < 1e-12);
  assert.equal(record.usage.quality, 'low');
  const file = await StoredFile.findOne({ userId, ownerType: 'image-result' }).lean();
  assert.equal(file.size, png.length);
  const repeated = await generateImage(input);
  assert.equal(repeated.status, 409);
  const changed = await generateImage({ ...input, body: { ...input.body, quality: 'high' } });
  assert.equal(changed.status, 409);
  const changedSize = await generateImage({ ...input, body: { ...input.body, size: '1024x1024' } });
  assert.equal(changedSize.status, 409);
  assert.equal(requests, 1);
});

test('编辑缺少用量仍保存图片，费用保持待核对且金额为空', async t => {
  const before = await StoredFile.countDocuments({ userId });
  t.mock.method(undici, 'fetch', async (url, init) => {
    assert.equal(String(url), 'https://www.micuapi.ai/v1/images/edits');
    assert.equal(init.body.getAll('image[]').length, 10);
    assert.equal(init.body.get('quality'), 'low');
    return Response.json({ data: [{ b64_json: png.toString('base64') }] });
  });
  const result = await editImage({ userId, body: { ...options, prompt: '组合参考图', images: Array.from({ length: 10 }, (_, i) => new File([png], `${i}.png`, { type: 'image/png' })) }, clientOperationId: crypto.randomUUID() });
  assert.equal(result.status, 200);
  assert.equal(result.data.billing.status, 'review_required');
  assert.equal(result.data.billing.actualCostCny, null);
  assert.equal(await StoredFile.countDocuments({ userId }), before + 1);
});

for (const count of [0, 1, 2]) {
  test(`Micu 拒绝 ${count} 张参考图的请求时返回具体原因，释放费用且不保存图片`, async t => {
    const before = await StoredFile.countDocuments({ userId });
    const requestId = `rejected-${count}`;
    const detail = count === 0 ? 'Too Many Requests' : 'Invalid quality for this request';
    const upstream = t.mock.method(undici, 'fetch', async () => Response.json({
      error: { message: detail }, request_id: requestId,
    }, { status: 400 }));
    t.mock.method(console, 'error', () => {});
    const operation = count === 0 ? generateImage : editImage;
    const result = await operation({
      userId,
      body: { ...options, prompt: '测试拒绝请求', images: Array.from({ length: count }, (_, i) => new File([png], `${i}.png`, { type: 'image/png' })) },
      clientOperationId: crypto.randomUUID(),
    });
    assert.equal(result.status, count === 0 ? 429 : 400);
    assert.equal(result.data.success, false);
    assert.ok(result.data.message.includes(detail));
    assert.equal(result.data.billing.status, 'released');
    const record = await Transaction.findOne({ userId, upstreamRequestIds: requestId }).lean();
    assert.equal(record.status, 'released');
    assert.equal(record.actualCostCny, 0);
    assert.equal(record.actualCostUsd, 0);
    assert.equal(await StoredFile.countDocuments({ userId }), before);
    assert.equal(upstream.mock.callCount(), count === 0 ? 5 : 1);
  });
}

test('无效尺寸和伪装文件在发送上游之前被拒绝', async t => {
  t.mock.method(undici, 'fetch', () => { throw new Error('不应发送'); });
  const invalid = await generateImage({ userId, body: { ...options, size: '999x999', prompt: 'test' }, clientOperationId: crypto.randomUUID() });
  assert.equal(invalid.status, 400);
  const edited = await editImage({ userId, body: { ...options, prompt: 'test', images: [new File(['not an image'], 'fake.png', { type: 'image/png' })] }, clientOperationId: crypto.randomUUID() });
  assert.equal(edited.status, 400);
  assert.equal(undici.fetch.mock.callCount(), 0);
});

test('任务能力按所选图片服务配置，历史仅尺寸设置提示重新保存', async () => {
  async function capabilities(image) {
    const entries = [];
    await registerMediaTools({ registry: { add: entry => entries.push(entry) }, task: { _id: new mongoose.Types.ObjectId(), userId, conversationId: new mongoose.Types.ObjectId(), mediaSettings: { image } }, signal: new AbortController().signal, assertActive: async () => {} });
    return { entries, value: await entries.find(entry => entry.definition.name === 'media_capabilities').execute() };
  }
  const configured = await capabilities(options);
  assert.equal(configured.value.image.available, true);
  assert.ok(configured.entries.some(entry => entry.definition.name === 'edit_image'));
  const legacy = await capabilities({ size: 'auto' });
  assert.equal(legacy.value.image.available, false);
  assert.match(legacy.value.image.reason, /管理员/);
});

test('图片创作配置备份保留模型及画质，排除凭据', async () => {
  const { safeMediaSettings } = await import('../../lib/server/backups/snapshot.mjs');
  assert.deepEqual(safeMediaSettings({ image: { ...options, apiKey: 'secret' } }), { image: options });
});

async function createImageTask(image) {
  await saveMediaSettings({ image: { ...image, enabled: true } });
  const preferences = await getAgentMediaSettings();
  const conversation = await Conversation.create({
    userId, title: '图片创作验收', messages: [{ id: 'image-user', role: 'user', content: '生成并编辑图片' }, { id: 'image-assistant', role: 'model', content: '' }],
  });
  const requestId = crypto.randomUUID();
  const stored = await Task.create({
    userId, conversationId: conversation._id, requestId, fingerprint: requestId,
    userMessageId: 'image-user', modelMessageId: 'image-assistant', model: 'deepseek-flash',
    status: 'running', mediaSettings: preferences,
  });
  const task = await Task.findById(stored._id).lean();
  const entries = [];
  await registerMediaTools({
    registry: { add: entry => entries.push(entry) }, task,
    signal: new AbortController().signal,
    assertActive: async () => assert.ok(await Task.exists({ _id: task._id, userId, status: 'running', stopRequested: false })),
  });
  return { task, tool: name => entries.find(entry => entry.definition.name === name) };
}

for (const savedOptions of [options, { model: 'gpt-image-2.5-flare', size: '1152x2048', quality: 'xhigh' }]) {
  test(`对话图片工具使用已保存的 ${savedOptions.model} 和尺寸，固定 low 并登记生成、编辑产物及费用`, async t => {
    const { task, tool } = await createImageTask(savedOptions);
    const upstreamRequests = [];
    t.mock.method(undici, 'fetch', async (url, init) => {
      const editing = String(url) === 'https://www.micuapi.ai/v1/images/edits';
      assert.ok(editing || String(url) === 'https://www.micuapi.ai/v1/images/generations');
      const input = editing ? Object.fromEntries(init.body.entries()) : JSON.parse(init.body);
      assert.equal(input.model, savedOptions.model);
      assert.equal(input.size, savedOptions.size);
      assert.equal(input.quality, 'low');
      assert.equal(input.prompt, editing ? '把花瓶改成绿色' : '蓝色花瓶');
      if (editing) {
        const images = init.body.getAll('image');
        assert.equal(images.length, 1);
        assert.deepEqual(Buffer.from(await images[0].arrayBuffer()), png);
      }
      upstreamRequests.push(editing ? 'edit' : 'generate');
      const usage = editing
        ? { input_tokens: 600, input_tokens_details: { text_tokens: 100, image_tokens: 500 }, output_tokens: 300, total_tokens: 900 }
        : { input_tokens: 100, input_tokens_details: { text_tokens: 100, image_tokens: 0 }, output_tokens: 200, total_tokens: 300 };
      return Response.json({ data: [{ b64_json: png.toString('base64') }], usage });
    });
    const generated = await tool('generate_image').execute({ prompt: '蓝色花瓶', name: '原始花瓶' }, { callId: 'generate-vase' });
    assert.equal(generated.completed, true);
    const edited = await tool('edit_image').execute({ prompt: '把花瓶改成绿色', name: '绿色花瓶', imageFileIdsJson: JSON.stringify([generated.artifacts[0].fileId]) }, { callId: 'edit-vase' });
    assert.equal(edited.completed, true);
    assert.notEqual(edited.artifacts[0].fileId, generated.artifacts[0].fileId);
    const recorded = await Task.findById(task._id).lean();
    assert.deepEqual(recorded.mediaSettings.image, { ...savedOptions, quality: 'low', count: savedOptions.count || 1 });
    assert.deepEqual(recorded.artifacts.map(item => item.fileId), [generated.artifacts[0].fileId, edited.artifacts[0].fileId]);
    assert.deepEqual(recorded.mediaTasks.map(item => item.status), ['completed', 'completed']);
    assert.deepEqual(recorded.mediaTasks.map(item => item.billingStatus), ['settled', 'settled']);
    assert.ok(Math.abs(recorded.costCny - 0.1344) < 1e-12);
    assert.equal(recorded.billingReviewRequired, false);
    for (const [result, expectedCost] of [[generated, 0.04368], [edited, 0.09072]]) {
      const transaction = await Transaction.findOne({ operationId: result.operationId, userId }).lean();
      assert.equal(transaction.model, savedOptions.model);
      assert.equal(transaction.provider, 'micu');
      assert.equal(transaction.status, 'settled');
      assert.equal(transaction.usage.size, savedOptions.size);
      assert.equal(transaction.usage.quality, 'low');
      assert.ok(Math.abs(transaction.actualCostCny - expectedCost) < 1e-12);
      const file = await StoredFile.findOne({ fileId: result.artifacts[0].fileId, userId }).lean();
      assert.equal(file.ownerType, 'task');
      assert.equal(file.ownerId, String(task._id));
      assert.equal(file.category, 'image');
      assert.deepEqual(await readStoredFileBuffer(file), png);
      const media = recorded.mediaTasks.find(item => item.operationId === result.operationId);
      assert.equal(media.imageArtifactFileIds[0], file.fileId);
      assert.equal(media.artifactClaimed, true);
      assert.ok(Math.abs(media.accountedCostCny - expectedCost) < 1e-12);
    }
    assert.equal(await TaskEvent.countDocuments({ taskId: task._id, type: 'artifact' }), 2);
    assert.equal(await TaskEvent.countDocuments({ taskId: task._id, type: 'billing' }), 2);
    await assert.rejects(tool('generate_image').execute({ prompt: '蓝色花瓶', name: '重复花瓶' }, { callId: 'generate-vase' }), /重复提交/);
    assert.deepEqual(upstreamRequests, ['generate', 'edit']);
    assert.equal((await Task.findById(task._id).lean()).costCny, recorded.costCny);
  });
}

test('首次保存单个媒体分组时建立完整的平台初始配置', async () => {
  await MediaSettings.deleteMany({});
  await saveMediaSettings({ audio: { voiceId: '933563129e564b19a115bedd57b7406a', model: 's2.1-pro-free' } });
  const settings = await getMediaSettings();
  assert.equal(settings.image.model, model);
  assert.equal(settings.image.enabled, false);
  await saveMediaSettings({ image: { size: '2048x1152' } });
  assert.equal((await getMediaSettings()).image.size, '2048x1152');
  await seedMediaSettings();
});

test('管理员可发布规范化共享音色，删除默认音色后Agent撤下配音能力', async () => {
  const voiceId = '933563129e564b19a115bedd57b7406a';
  await saveMediaSettings({ audio: { model: 's2.1-pro-free', voiceId: `  ${voiceId}  `, enabled: true } });
  assert.equal((await getAgentMediaSettings()).audio.voiceId, voiceId);
  await clearSharedVoice('other-voice');
  assert.equal((await getAgentMediaSettings()).audio.voiceId, voiceId);
  await clearSharedVoice(voiceId);
  assert.equal((await getAgentMediaSettings()).audio, undefined);
  assert.equal((await getMediaSettings()).audio.hasApiKey, true);
  await seedMediaSettings();
});

test('全局媒体配置加密保存，Agent 获取共享参数且不接触密钥', async () => {
  const result = await saveMediaSettings({ image: { enabled: true, ...options, apiKey: 'global-image-secret' } });
  assert.equal(result.image.hasApiKey, true);
  assert.equal(JSON.stringify(result).includes('global-image-secret'), false);
  const stored = await MediaSettings.findById('media').lean();
  assert.equal(JSON.stringify(stored).includes('global-image-secret'), false);
  const runtime = await getAgentMediaSettings();
  assert.equal(runtime.image.model, model);
  assert.equal(runtime.image.baseUrl, undefined);
  assert.equal(runtime.image.encryptedApiKey, undefined);
  await assert.rejects(saveMediaSettings({ image: { size: 'invalid' } }), /尺寸/);
  await assert.rejects(saveMediaSettings({ image: { baseUrl: 'http://127.0.0.1' } }), /HTTPS/);
  await assert.rejects(saveMediaSettings({ image: { baseUrl: 'https://example.com' } }), /重新填写密钥/);
  await saveMediaSettings({ image: { enabled: false } });
  assert.equal((await getAgentMediaSettings()).image, undefined);
  assert.equal((await getMediaSettings()).image.enabled, false);
  await seedMediaSettings();
});

test('四图并行按原顺序返回部分成功，整组只记一次费用', async t => {
  let calls = 0;
  const releases = [];
  t.mock.method(undici, 'fetch', async () => {
    const index = calls++;
    await new Promise(resolve => { releases[index] = resolve; setTimeout(resolve, 100); if (releases.length === 4) releases.toReversed().forEach(release => release()); });
    if (index === 1) return Response.json({ error: { message: 'content policy violation' }, request_id: 'batch-rejected' }, { status: 400 });
    return Response.json({ request_id: `batch-${index}`, data: [{ b64_json: png.toString('base64') }], usage: { input_tokens: 100, input_tokens_details: { text_tokens: 100, image_tokens: 0 }, output_tokens: 200, total_tokens: 300 } });
  });
  const result = await generateImage({ userId, body: { ...options, count: 4, prompt: '四张花瓶' }, clientOperationId: crypto.randomUUID() });
  assert.equal(result.status, 200);
  assert.equal(result.data.results.length, 4);
  assert.deepEqual(result.data.results.map(item => item.success), [true, false, true, true]);
  assert.equal(result.data.results[1].message.includes('content policy'), true);
  assert.equal(calls, 4);
  assert.equal(result.data.billing.status, 'settled');
  assert.ok(Math.abs(result.data.billing.actualCostCny - 0.13104) < 1e-12);
  for (const item of result.data.results.filter(item => item.success)) assert.ok(await StoredFile.exists({ fileId: item.fileId, userId }));
  assert.equal(await Transaction.countDocuments({ userId, upstreamRequestIds: 'batch-0' }), 1);
});

test('图片数量仅接受 1 至 4 的整数', async () => {
  const { validateImageOptions } = await import('../../lib/media/shared/models.js');
  for (const count of [0, 5, 1.5, '2', null]) assert.throws(() => validateImageOptions({ ...options, count }), /数量/);
  assert.equal(validateImageOptions(options).count, 1);
  assert.equal(validateImageOptions({ ...options, count: 4 }).count, 4);
});

test('助手交付全部图片文件，部分失败仍登记成功产物', async t => {
  const { task, tool } = await createImageTask({ ...options, count: 3 });
  let calls = 0;
  t.mock.method(undici, 'fetch', async () => {
    if (++calls === 2) return Response.json({ error: { message: 'safety rejection' } }, { status: 400 });
    return Response.json({ data: [{ b64_json: png.toString('base64') }] });
  });
  const result = await tool('generate_image').execute({ prompt: '花瓶', name: '花瓶' }, { callId: 'batch-vase' });
  assert.equal(result.artifacts.length, 2);
  assert.equal(result.failures.length, 1);
  const recorded = await Task.findById(task._id).lean();
  assert.equal(recorded.artifacts.length, 2);
  assert.equal(new Set(recorded.artifacts.map(item => item.fileId)).size, 2);
});

for (const lastResponse of ['success', 'rejected']) {
  test(`网络结果不明后${lastResponse}仍将整组费用保留待核对`, async t => {
    let calls = 0;
    t.mock.method(undici, 'fetch', async () => {
      if (++calls === 1) throw new TypeError('network failure');
      return lastResponse === 'success'
        ? Response.json({ request_id: 'after-network', data: [{ b64_json: png.toString('base64') }], usage: { input_tokens: 100, input_tokens_details: { text_tokens: 100, image_tokens: 0 }, output_tokens: 200, total_tokens: 300 } })
        : Response.json({ request_id: 'after-network', error: { code: 'insufficient_quota' } }, { status: 429 });
    });
    const result = await generateImage({ userId, body: { ...options, prompt: '花瓶' }, clientOperationId: crypto.randomUUID() });
    assert.equal(result.data.billing.status, 'review_required');
    assert.equal(result.data.billing.actualCostCny, null);
    assert.equal(calls, 2);
    assert.equal(result.data.success, lastResponse === 'success');
    const record = await Transaction.findOne({ operationId: result.data.billing.operationId }).lean();
    assert.equal(record.usage.imageOutcomes[0].attempts.length, 2);
  });
}

test('GPT 保存文件失败不重新生成且保留用量', async t => {
  const upstream = t.mock.method(undici, 'fetch', async () => Response.json({ data: [{ b64_json: png.toString('base64') }], usage: { input_tokens: 100, input_tokens_details: { text_tokens: 100, image_tokens: 0 }, output_tokens: 200, total_tokens: 300 } }));
  t.mock.method(StoredFile, 'create', async () => {
    throw Object.assign(new Error('INTERNAL_STORAGE_MARKER'), { status: 500 });
  });
  const stored = await generateImage({ userId, body: { ...options, prompt: '花瓶' }, clientOperationId: crypto.randomUUID() });
  assert.equal(stored.data.success, false);
  assert.equal(stored.data.message, '图片处理失败');
  assert.equal(stored.data.results[0].message, '图片处理失败');
  assert.equal(upstream.mock.callCount(), 1);
  assert.equal(stored.data.billing.status, 'settled');
});

test('图片操作内部异常只返回通用提示', async () => {
  const body = { prompt: '花瓶' };
  Object.defineProperty(body, 'model', {
    get() { throw Object.assign(new Error('INTERNAL_CONFIG_MARKER'), { status: 500 }); },
  });
  const result = await generateImage({ userId, body, clientOperationId: crypto.randomUUID() });
  assert.equal(result.status, 500);
  assert.equal(result.data.message, '图片处理失败');
});

test('取消整组会停止四个未完成请求且不再重试', async t => {
  const controller = new AbortController();
  let resolveStarted;
  const started = new Promise(resolve => { resolveStarted = resolve; });
  let calls = 0;
  t.mock.method(undici, 'fetch', async (_url, { signal }) => {
    if (++calls === 4) resolveStarted();
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  const resultPromise = generateImage({ userId, body: { ...options, count: 4, prompt: '花瓶' }, clientOperationId: crypto.randomUUID(), signal: controller.signal });
  await started;
  controller.abort();
  const result = await resultPromise;
  assert.equal(calls, 4);
  assert.equal(result.data.results.length, 4);
  assert.ok(result.data.results.every(item => !item.success && item.status === 499));
  assert.equal(result.data.billing.status, 'review_required');
});
