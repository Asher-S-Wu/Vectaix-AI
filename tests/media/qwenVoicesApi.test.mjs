import assert from 'node:assert/strict';
import test from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { seedMediaSettings } from '../helpers/media-config.mjs';
import { encryptSecret } from '../../lib/server/security/secrets.mjs';
import { QWEN_AUDIO_DEFAULTS } from '../../lib/media/shared/qwenAudio.js';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

globalThis.AsyncLocalStorage = AsyncLocalStorage;
const model = 'qwen-audio-3.1-tts-plus';
let mongo, directory, User, Session, Voice, voicesRoute, voiceRoute, workAsyncStorage, workUnitAsyncStorage, RequestCookies;
test.before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  directory = await mkdtemp(path.join(os.tmpdir(), 'vectaix-qwen-voices-'));
  process.env.STORAGE_ROOT = directory;
  const { default: dbConnect } = await import('../../lib/db.js'); await dbConnect();
  await seedMediaSettings();
  const { default: Settings } = await import('../../models/MediaSettings.js');
  await Settings.updateOne({ _id: 'media' }, { $set: { qwenAudio: { ...QWEN_AUDIO_DEFAULTS, enabled: true, encryptedApiKey: encryptSecret('test-qwen-key', 'media:qwenAudio') } } });
  ({ default: User } = await import('../../models/User.js'));
  ({ default: Session } = await import('../../models/Session.js'));
  ({ default: Voice } = await import('../../models/QwenVoice.js'));
  ({ workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external.js'));
  ({ workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external.js'));
  ({ RequestCookies } = await import('next/dist/server/web/spec-extension/cookies.js'));
  voicesRoute = await import('../../app/api/media/audio/qwen/voices/route.js');
  voiceRoute = await import('../../app/api/media/audio/qwen/voices/[id]/route.js');
});
test.after(async () => { await mongoose.disconnect(); await mongo.stop(); await rm(directory, { recursive: true, force: true }); });

async function login(label) {
  const email = `${label}@qwen.test`;
  process.env.ADMIN_EMAILS = [process.env.ADMIN_EMAILS, email].filter(Boolean).join(',');
  const user = await User.create({ email, password: 'test-only' });
  const token = randomBytes(32).toString('base64url');
  await Session.create({ userId: user._id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 60000) });
  return { userId: String(user._id), token };
}
function call(token, handler, request, id) {
  const headers = new Headers(token ? { cookie: `token=${token}` } : {});
  return workAsyncStorage.run({ route: '/api/media/audio/qwen/voices' }, () => workUnitAsyncStorage.run({ type: 'request', phase: 'render', cookies: new RequestCookies(headers) }, () => handler(request, { params: Promise.resolve({ id }) })));
}
function wav(seconds = 10, sampleRate = 16000) {
  const dataSize = seconds * sampleRate * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF'); buffer.writeUInt32LE(36 + dataSize, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}
function cloneRequest(sample = wav(), consent = 'true') {
  const form = new FormData();
  form.set('displayName', '我的 Qwen 声音'); form.set('consentConfirmed', consent);
  form.set('sample', new File([sample], 'sample.wav', { type: 'audio/wav' }));
  return new Request('https://app.test/api/media/audio/qwen/voices', { method: 'POST', body: form });
}
function voiceRequest(id, method = 'GET') { return new Request(`https://app.test/api/media/audio/qwen/voices/${id}`, { method }); }

test('Qwen voice routes require admin authentication and expose the built-in voice without an upstream call', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected request'); });
  assert.equal((await call(null, voicesRoute.GET, new Request('https://app.test/api/media/audio/qwen/voices'))).status, 401);
  assert.equal((await call(null, voicesRoute.POST, cloneRequest())).status, 401);
  const owner = await login('builtin');
  const response = await call(owner.token, voicesRoute.GET, new Request('https://app.test/api/media/audio/qwen/voices'));
  const { voices } = await response.json();
  assert.equal(voices[0].voiceId, 'longanhuan_v3.1');
  assert.equal(voices[0].builtin, true);
  assert.equal(fetch.mock.callCount(), 0);
});

test('Qwen rejects damaged, short, oversized-duration, low-rate and unauthorized samples before upload', async t => {
  const owner = await login('invalid');
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected request'); });
  for (const request of [cloneRequest(Buffer.from('broken')), cloneRequest(wav(4)), cloneRequest(wav(61)), cloneRequest(wav(10, 8000)), cloneRequest(wav(), 'false')]) {
    assert.equal((await call(owner.token, voicesRoute.POST, request)).status, 400);
  }
  assert.equal(await Voice.countDocuments({ userId: owner.userId }), 0);
  assert.equal(fetch.mock.callCount(), 0);
});

test('Qwen clone, refresh and delete persist consent, enforce ownership and update the shared default', async t => {
  const owner = await login('owner'), outsider = await login('outsider');
  const sample = wav();
  const voiceId = `${model}-vectaix-${randomBytes(16).toString('hex')}`;
  const actions = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://ws-2t7yj3g991jc5yo6.ap-southeast-1.maas.aliyuncs.com/api/v1/services/audio/tts/customization');
    const input = JSON.parse(options.body).input; actions.push(input.action);
    if (input.action === 'create_voice') {
      assert.equal(input.target_model, model);
      assert.equal(input.audio, `data:audio/wav;base64,${sample.toString('base64')}`);
      return Response.json({ output: { voice_id: voiceId }, request_id: 'clone-1' });
    }
    assert.equal(input.voice_id, voiceId);
    return Response.json({ output: input.action === 'query_voice' ? { status: 'OK', target_model: model } : {}, request_id: 'voice-1' });
  });
  const created = await call(owner.token, voicesRoute.POST, cloneRequest(sample));
  assert.equal(created.status, 201);
  const { voice } = await created.json();
  const saved = await Voice.findOne({ profileId: voice.profileId }).lean();
  assert.equal(String(saved.userId), owner.userId);
  assert.equal(saved.status, 'training');
  assert.ok(saved.consentConfirmedAt instanceof Date);
  for (const method of ['GET', 'DELETE']) assert.equal((await call(outsider.token, voiceRoute[method], voiceRequest(voice.profileId, method), voice.profileId)).status, 404);
  const ready = await call(owner.token, voiceRoute.GET, voiceRequest(voice.profileId), voice.profileId);
  assert.equal((await ready.json()).voice.status, 'trained');
  const { saveMediaSettings, getAgentMediaSettings } = await import('../../lib/server/media/settings.js');
  await saveMediaSettings({ audioProvider: 'qwen', qwenAudio: { voiceId } });
  assert.equal((await getAgentMediaSettings()).audio.voiceId, voiceId);
  const removed = await call(owner.token, voiceRoute.DELETE, voiceRequest(voice.profileId, 'DELETE'), voice.profileId);
  assert.equal(removed.status, 200);
  assert.equal(await Voice.countDocuments({ userId: owner.userId }), 0);
  assert.equal((await getAgentMediaSettings()).audio, undefined);
  assert.deepEqual(actions, ['create_voice', 'query_voice', 'delete_voice']);
});

test('Deleting an account removes its upstream Qwen voice and local voice and generation records', async t => {
  const owner = await login('delete-account');
  const voiceId = `${model}-vectaix-${randomBytes(16).toString('hex')}`;
  await Voice.create({ userId: owner.userId, voiceId, displayName: '待删除音色', status: 'trained', consentConfirmedAt: new Date(), sampleFileName: 'sample.wav', lastStatusCheckedAt: new Date() });
  const { default: Settings } = await import('../../models/MediaSettings.js');
  await Settings.updateOne({ _id: 'media' }, { $set: { 'qwenAudio.enabled': false } });
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body).input, { action: 'delete_voice', voice_id: voiceId });
    return Response.json({ output: {}, request_id: 'delete-account' });
  });
  const { deleteUserAndData } = await import('../../lib/server/users/deleteUser.js');
  assert.deepEqual(await deleteUserAndData(owner.userId), { success: true });
  assert.equal(await Voice.countDocuments({ userId: owner.userId }), 0);
  assert.equal(await User.exists({ _id: owner.userId }), null);
});
