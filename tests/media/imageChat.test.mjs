import test from 'node:test';
import undici from 'undici';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

globalThis.AsyncLocalStorage = AsyncLocalStorage;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5X8AAAAASUVORK5CYII=', 'base64');
const models = ['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare'];
let mongo, directory, userId, token, POST, Conversation, Transaction, call;

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  directory = await mkdtemp(path.join(os.tmpdir(), 'vectaix-image-chat-'));
  process.env.MONGO_URI = mongo.getUri();
  process.env.STORAGE_ROOT = directory;
  process.env.MICU_API_KEY = 'test-only';
  const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external.js');
  const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external.js');
  const { RequestCookies } = await import('next/dist/server/web/spec-extension/cookies.js');
  const { default: dbConnect } = await import('../../lib/db.js');
  const { default: User } = await import('../../models/User.js');
  const { default: Session } = await import('../../models/Session.js');
  ({ default: Conversation } = await import('../../models/Conversation.js'));
  ({ default: Transaction } = await import('../../models/CreditTransaction.js'));
  ({ POST } = await import('../../app/api/chat/media/route.js'));
  await dbConnect();
  userId = String((await User.create({ email: 'image-chat@example.test', password: 'test-only' }))._id);
  token = randomBytes(32).toString('base64url');
  await Session.create({ userId, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 600000) });
  call = (body, operationId = randomUUID()) => {
    const headers = new Headers({ cookie: `token=${token}`, 'content-type': 'application/json', 'x-credit-operation-id': operationId });
    const request = new Request('http://test/api/chat/media', { method: 'POST', headers, body: JSON.stringify(body) });
    return workAsyncStorage.run({ route: '/api/chat/media' }, () => workUnitAsyncStorage.run({ type: 'request', phase: 'render', cookies: new RequestCookies(headers) }, () => POST(request)));
  };
});

test.after(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
  if (directory) await rm(directory, { recursive: true, force: true });
});

for (const model of models) {
  test(`${model} 聊天生成、单图及多图编辑保存参数、图片信息和待核对费用`, async t => {
    const options = { model, size: '1024x1024', quality: 'auto' };
    let calls = 0;
    t.mock.method(undici, 'fetch', async (url, init) => {
      calls++;
      if (calls === 1) {
        assert.match(String(url), /\/generations$/);
        assert.deepEqual(JSON.parse(init.body), { ...options, prompt: '蓝色花瓶', n: 1, response_format: 'b64_json' });
      } else {
        assert.match(String(url), /\/edits$/);
        assert.equal(init.body.get('model'), model);
        assert.equal(init.body.get('quality'), 'auto');
        assert.equal(init.body.getAll(calls === 2 ? 'image' : 'image[]').length, calls - 1);
      }
      return Response.json({ data: [{ b64_json: png.toString('base64') }] });
    });
    const input = { model, prompt: '蓝色花瓶', history: [], config: { media: options } };
    const operationId = randomUUID();
    const response = await call(input, operationId);
    assert.equal(response.status, 200);
    const conversationId = response.headers.get('x-conversation-id');
    const events = await response.text();
    assert.match(events, /image_gen_complete/);
    assert.match(events, /credit_review_required/);
    assert.doesNotMatch(events, /stream_error/);
    let conversation = await Conversation.findById(conversationId).lean();
    const first = conversation.messages[1].parts[0].inlineData;
    assert.equal(first.size, png.length);
    assert.match(first.name, /\.png$/);
    assert.equal(conversation.messages[1].providerState.media.model, model);
    assert.equal((await call(input, operationId)).status, 409);
    const edited = await call({ ...input, conversationId, config: { media: options, images: [first] } });
    assert.doesNotMatch(await edited.text(), /stream_error/);
    conversation = await Conversation.findById(conversationId).lean();
    assert.equal(conversation.messages[2].parts[1].inlineData.size, png.length);
    const second = conversation.messages[3].parts[0].inlineData;
    const multiple = await call({ ...input, conversationId, config: { media: options, images: [first, second] } });
    assert.match(await multiple.text(), /image_gen_complete/);
    assert.equal(calls, 3);
    const billings = await Transaction.find({ userId, model }).lean();
    assert.equal(billings.length, 3);
    assert.ok(billings.every(item => item.status === 'review_required' && item.actualCostCny === null));
    assert.ok(billings.every(item => item.usage.requestFingerprint && item.usage.quality === 'auto'));

    const { safeConversation } = await import('../../lib/server/backups/snapshot.mjs');
    const backup = safeConversation(await Conversation.findById(conversationId).lean());
    const restoredMessages = backup.messages.slice(0, 1);
    assert.deepEqual(restoredMessages[0].providerState.media, options);
    t.mock.method(undici, 'fetch', async (_url, init) => {
      assert.equal(JSON.parse(init.body).quality, options.quality);
      assert.equal(JSON.parse(init.body).size, options.size);
      return Response.json({ data: [{ b64_json: png.toString('base64') }] });
    });
    const regenerated = await call({ ...input, conversationId, mode: 'regenerate', messages: restoredMessages });
    assert.match(await regenerated.text(), /image_gen_complete/);
  });
}

test('聊天图片不接收不支持的尺寸和他人的参考图', async t => {
  t.mock.method(undici, 'fetch', () => { throw new Error('不应发送'); });
  const input = { model: models[0], prompt: 'test', history: [], config: { media: { size: '999x999', quality: 'auto' } } };
  assert.equal((await call(input)).status, 400);
  input.config.media.size = '1024x1024';
  input.config.images = [{ fileId: randomUUID() }];
  assert.equal((await call(input)).status, 404);
  assert.equal(undici.fetch.mock.callCount(), 0);
});

test('消息经过客户端和服务端保存仍保留图片名称、大小', async () => {
  const { buildPersistedConversationMessages } = await import('../../lib/client/chat/messagePersistence.js');
  const { sanitizeStoredMessagesStrict } = await import('../../app/api/chat/utils.js');
  const { sanitizeMessages } = await import('../../lib/server/conversations/sanitize.js');
  const fileId = randomUUID();
  const inlineData = { fileId, url: `/api/files/${fileId}`, mimeType: 'image/png', name: '参考.png', size: png.length };
  const messages = [{ id: randomUUID(), role: 'user', content: 'test', type: 'parts', parts: [{ inlineData }] }];
  const sanitized = sanitizeStoredMessagesStrict(buildPersistedConversationMessages(messages));
  assert.deepEqual(sanitized[0].parts[0].inlineData, inlineData);
  assert.deepEqual(sanitizeMessages(sanitized)[0].parts[0].inlineData, inlineData);
});
