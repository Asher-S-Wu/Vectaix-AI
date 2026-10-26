import assert from 'node:assert/strict';
import test from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

globalThis.AsyncLocalStorage = AsyncLocalStorage;
let mongo, directory, User, Session, File, Conversation, createFile, filePath, historyRoute, deletionRoute, workAsyncStorage, workUnitAsyncStorage, RequestCookies;
test.before(async () => {
  mongo = await MongoMemoryServer.create(); process.env.MONGO_URI = mongo.getUri();
  directory = await mkdtemp(path.join(os.tmpdir(), 'huajuan-image-history-')); process.env.STORAGE_ROOT = directory;
  const { default: connect } = await import('../../lib/db.js'); await connect();
  ({ default: User } = await import('../../models/User.js')); ({ default: Session } = await import('../../models/Session.js'));
  ({ default: File } = await import('../../models/StoredFile.js')); ({ default: Conversation } = await import('../../models/Conversation.js'));
  ({ createStoredFile: createFile, getStoredFileAbsolutePath: filePath } = await import('../../lib/server/storage/service.js'));
  ({ workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external.js'));
  ({ workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external.js'));
  ({ RequestCookies } = await import('next/dist/server/web/spec-extension/cookies.js'));
  historyRoute = await import('../../app/api/media/image/history/route.js');
  deletionRoute = await import('../../app/api/media/image/history/[id]/route.js');
});
test.after(async () => { await mongoose.disconnect(); await mongo.stop(); await rm(directory, { recursive: true, force: true }); });
async function login(label) {
  const user = await User.create({ email: `${label}@image-history.test`, password: 'test-only' });
  const token = randomBytes(32).toString('base64url');
  await Session.create({ userId: user._id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 60000) });
  return { userId: String(user._id), token };
}
function call(token, handler, request, id) {
  const cookies = new RequestCookies(new Headers(token ? { cookie: `token=${token}` } : {}));
  return workAsyncStorage.run({ route: '/api/media/image/history' }, () => workUnitAsyncStorage.run({ type: 'request', phase: 'render', cookies }, () => handler(request, { params: Promise.resolve({ id }) })));
}
function image(userId) { return createFile({ userId, input: Buffer.from('saved-image'), originalName: '我的图片.png', mimeType: 'image/png', extension: 'png', category: 'image', kind: 'media-image', ownerType: 'image-result', ownerId: userId }); }

test('普通用户的图片历史分页无遗漏并隔离其他账号，未登录访问返回401', async () => {
  const owner = await login('owner'), outsider = await login('outsider');
  const ids = [];
  for (let i = 0; i < 26; i++) ids.push((await image(owner.userId)).fileId);
  await image(outsider.userId);
  assert.equal((await call(null, historyRoute.GET, new Request('https://app.test/api/media/image/history'))).status, 401);
  const first = await (await call(owner.token, historyRoute.GET, new Request('https://app.test/api/media/image/history'))).json();
  assert.equal(first.images.length, 24); assert.ok(first.nextCursor);
  assert.ok(!JSON.stringify(first).includes('storageKey'));
  const second = await (await call(owner.token, historyRoute.GET, new Request(`https://app.test/api/media/image/history?cursor=${first.nextCursor}`))).json();
  assert.equal(second.images.length, 2); assert.equal(second.nextCursor, null);
  assert.deepEqual(new Set([...first.images, ...second.images].map(file => file.fileId)), new Set(ids));
});

test('删除图片同时移除记录和真实文件，跨账号或仍被对话引用时保留文件', async () => {
  const owner = await login('delete-owner'), outsider = await login('delete-outsider');
  const file = await image(owner.userId);
  const request = () => new Request(`https://app.test/api/media/image/history/${file.fileId}`, { method: 'DELETE' });
  assert.equal((await call(outsider.token, deletionRoute.DELETE, request(), file.fileId)).status, 404);
  await access(filePath(file));
  const conversation = await Conversation.create({ userId: owner.userId, title: '引用图片的对话', messages: [{ id: 'user-image', role: 'user', content: `/api/files/${file.fileId}` }] });
  assert.equal((await call(owner.token, deletionRoute.DELETE, request(), file.fileId)).status, 409);
  await access(filePath(file));
  await Conversation.deleteOne({ _id: conversation._id });
  assert.equal((await call(owner.token, deletionRoute.DELETE, request(), file.fileId)).status, 200);
  assert.equal(await File.exists({ fileId: file.fileId }), null);
  await assert.rejects(access(filePath(file)), { code: 'ENOENT' });
});
