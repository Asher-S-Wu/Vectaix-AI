import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let database, directory, userId, Voice, Transaction, generateMinimaxSpeech;
let claimMinimaxVoiceUnlock, reconcileMinimaxUnlockClaims, synthesizeMinimaxSpeech, isAmbiguousMinimaxAudioError;
const model = 'MiniMax/speech-2.8-turbo';

test.before(async () => {
  database = await MongoMemoryServer.create();
  directory = await mkdtemp(path.join(os.tmpdir(), 'vectaix-minimax-'));
  process.env.MONGO_URI = database.getUri();
  process.env.STORAGE_ROOT = directory;
  process.env.DASHSCOPE_BEIJING_API_KEY = 'test-key';
  const { default: dbConnect } = await import('../../lib/db.js');
  await dbConnect();
  const { default: User } = await import('../../models/User.js');
  userId = String((await User.create({ email: 'minimax@example.test', password: 'test-only' }))._id);
  ({ default: Voice } = await import('../../models/MinimaxVoice.js'));
  ({ default: Transaction } = await import('../../models/CreditTransaction.js'));
  await Voice.init();
  const { ensureCreditTransactionIndexes } = await import('../../models/CreditTransaction.js');
  await ensureCreditTransactionIndexes();
  ({ generateMinimaxSpeech } = await import('../../lib/media/server/operations/minimaxSpeech.js'));
  ({ claimMinimaxVoiceUnlock, reconcileMinimaxUnlockClaims } = await import('../../lib/media/server/minimaxUnlockClaims.js'));
  ({ synthesizeMinimaxSpeech, isAmbiguousMinimaxAudioError } = await import('../../lib/media/server/minimaxAudio.js'));
});

test.beforeEach(t => t.mock.method(console, 'error', () => {}));
test.after(async () => {
  await mongoose.disconnect();
  await database?.stop();
  if (directory) {
    assert.ok(directory.startsWith(path.join(os.tmpdir(), 'vectaix-minimax-')));
    await rm(directory, { recursive: true, force: true });
  }
});

async function createVoice() {
  return Voice.create({
    userId, voiceId: `test-${crypto.randomUUID()}`, displayName: '测试音色', status: 'READY',
    cloneModel: model, demoText: '你好', consentConfirmedAt: new Date(),
  });
}

function generate(voice) {
  return generateMinimaxSpeech({
    userId, clientOperationId: crypto.randomUUID(),
    body: { text: '你好', model, voiceId: voice.voiceId, format: 'wav' },
  });
}

function networkError(code) {
  return new TypeError('fetch failed', { cause: Object.assign(new Error('network failure'), { code }) });
}

test('连接阶段失败保留原始原因；中途断开和混合网络错误继续核对费用', async t => {
  const fetch = t.mock.method(globalThis, 'fetch');
  for (const code of ['UND_ERR_CONNECT_TIMEOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'ECONNRESET']) {
    const original = networkError(code);
    fetch.mock.mockImplementation(async () => { throw original; });
    await assert.rejects(synthesizeMinimaxSpeech({}), error => {
      assert.equal(error.cause, original);
      assert.equal(error.code, 'NETWORK_ERROR');
      const ambiguous = ['UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'ECONNRESET'].includes(code);
      assert.equal(isAmbiguousMinimaxAudioError(error), ambiguous);
      assert.equal(error.status, code === 'UND_ERR_CONNECT_TIMEOUT' ? 504 : 502);
      return true;
    });
  }
  for (const codes of [['ECONNREFUSED', 'ENETUNREACH'], ['ECONNREFUSED', 'ECONNRESET']]) {
    fetch.mock.mockImplementation(async () => {
      throw new TypeError('fetch failed', { cause: new AggregateError(codes.map(code => Object.assign(new Error(code), { code }))) });
    });
    await assert.rejects(synthesizeMinimaxSpeech({}), error => {
      assert.equal(error.requestNotSent, !codes.includes('ECONNRESET'));
      return true;
    });
  }
});

test('连接超时立即释放首次解锁占用，下一次请求能重新提交', async t => {
  const voice = await createVoice();
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw networkError('UND_ERR_CONNECT_TIMEOUT'); });
  const failed = await generate(voice);
  assert.equal(failed.status, 504);
  assert.equal(failed.data.billing.status, 'released');
  assert.equal(failed.data.billing.actualCostCny, 0);
  assert.equal((await Voice.findById(voice._id).lean()).claimOperationId, undefined);
  fetch.mock.mockImplementation(async () => Response.json({ output: { base_resp: { status_code: 1042 } } }));
  const retried = await generate(voice);
  assert.equal(retried.status, 400);
  assert.equal(retried.data.billing.status, 'released');
  assert.equal(fetch.mock.callCount(), 2);
});

test('响应中途断开时保留占用和原始用量，再次提交给出待确认提示', async t => {
  const voice = await createVoice();
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw networkError('UND_ERR_SOCKET'); });
  const failed = await generate(voice);
  assert.equal(failed.data.billing.status, 'review_required');
  const transaction = await Transaction.findOne({ operationId: failed.data.billing.operationId }).lean();
  assert.equal(transaction.usage.firstVoiceClone, true);
  assert.equal(transaction.usage.quality, 'turbo');
  assert.equal(transaction.usage.upstreamCompleted, false);
  const blocked = await generate(voice);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.code, 'MINIMAX_UNLOCK_REVIEW_REQUIRED');
  assert.match(blocked.data.message, /15 分钟/);
  assert.equal(fetch.mock.callCount(), 1);
});

async function staleClaim(status) {
  const voice = await createVoice();
  const operationId = crypto.randomUUID();
  await Voice.updateOne({ _id: voice._id }, { $set: { claimOperationId: operationId, claimStartedAt: new Date(Date.now() - 16 * 60 * 1000) } });
  await Transaction.create({
    operationId, userId, auditUserKey: 'test-audit', type: 'model_usage', status,
    provider: 'minimax', model,
    usage: { characters: 2, quality: 'turbo', firstVoiceClone: true },
  });
  return { voice, operationId };
}

for (const status of ['reserved', 'review_required']) {
  for (const activated of [false, true]) {
    test(`${status} 占用过期后查询服务端：${activated ? '已解锁避免重复解锁费' : '未使用释放占用和费用'}`, async t => {
      const { voice, operationId } = await staleClaim(status);
      const fetch = t.mock.method(globalThis, 'fetch', async (url, init) => {
        assert.equal(JSON.parse(init.body).input.voice_type, 'voice_cloning');
        return Response.json({ request_id: 'confirmed', output: { base_resp: { status_code: 0 }, voice_cloning: activated ? [{ voice_id: voice.voiceId }] : [] } });
      });
      const unlock = await claimMinimaxVoiceUnlock({ userId, profileId: voice.profileId, operationId: crypto.randomUUID() });
      assert.equal(unlock.claimed, !activated);
      assert.equal(unlock.firstVoiceClone, !activated);
      const current = await Voice.findById(voice._id).lean();
      assert.equal(Boolean(current.unlockedAt), activated);
      const transaction = await Transaction.findOne({ operationId }).lean();
      assert.equal(transaction.status, activated ? 'review_required' : 'released');
      assert.equal(transaction.actualCostCny, activated ? null : 0);
      assert.equal(fetch.mock.callCount(), 1);
    });
  }
}

test('查询失败或音色列表无效时保留原状态，成功响应缺少列表不会被当作空列表', async t => {
  const { voice, operationId } = await staleClaim('review_required');
  const fetch = t.mock.method(globalThis, 'fetch');
  for (const output of [undefined, {}, { voice_cloning: null }, { voice_cloning: [{}] }]) {
    fetch.mock.mockImplementation(async () => {
      if (!output) throw networkError('UND_ERR_CONNECT_TIMEOUT');
      return Response.json({ output: { base_resp: { status_code: 0 }, ...output } });
    });
    await assert.rejects(reconcileMinimaxUnlockClaims(new Date(), { userId, profileId: voice.profileId }));
    assert.equal((await Voice.findById(voice._id).lean()).claimOperationId, operationId);
    assert.equal((await Transaction.findOne({ operationId }).lean()).status, 'review_required');
  }
});

test('活跃首次解锁保持互斥，两次并发提交只允许一次取得占用', async t => {
  const voice = await createVoice();
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected request'); });
  const results = await Promise.allSettled([1, 2].map(() => claimMinimaxVoiceUnlock({ userId, profileId: voice.profileId, operationId: crypto.randomUUID() })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'MINIMAX_UNLOCK_IN_PROGRESS');
  assert.equal(fetch.mock.callCount(), 0);
});

test('失败费用已释放时清除残留占用，保留的首次解锁用量不会被误判为成功', async t => {
  const { voice, operationId } = await staleClaim('released');
  await Transaction.updateOne({ operationId }, { $set: { 'usage.failedBeforeCompletion': true } });
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected request'); });
  const result = await reconcileMinimaxUnlockClaims(new Date(), { userId, profileId: voice.profileId });
  assert.equal(result.cleared, 1);
  const current = await Voice.findById(voice._id).lean();
  assert.equal(current.claimOperationId, undefined);
  assert.equal(current.unlockedAt, null);
  assert.equal(fetch.mock.callCount(), 0);
});

test('已收到合成成功响应时直接完成解锁，用量待核对的记录保持原状', async t => {
  const { voice, operationId } = await staleClaim('review_required');
  await Transaction.updateOne({ operationId }, { $set: { 'usage.upstreamCompleted': true } });
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected request'); });
  const result = await reconcileMinimaxUnlockClaims(new Date(), { userId, profileId: voice.profileId });
  assert.equal(result.unlocked, 1);
  assert.ok((await Voice.findById(voice._id).lean()).unlockedAt);
  assert.equal((await Transaction.findOne({ operationId }).lean()).status, 'review_required');
  assert.equal(fetch.mock.callCount(), 0);
});

for (const alreadyUnlocked of [false, true]) {
  test(`${alreadyUnlocked ? '已解锁音色仅计字符费用' : '首次成功合成记录解锁费'}，并保存音频`, async t => {
    const voice = await createVoice();
    if (alreadyUnlocked) await Voice.updateOne({ _id: voice._id }, { $set: { unlockedAt: new Date() } });
    t.mock.method(globalThis, 'fetch', async (url) => {
      if (String(url).includes('.oss-cn-beijing.aliyuncs.com/')) {
        return new Response(Buffer.from('RIFF test audio'), { headers: { 'content-type': 'audio/wav' } });
      }
      return Response.json({ request_id: 'speech', usage: { characters: 2 }, output: {
        base_resp: { status_code: 0 }, data: { audio: 'https://dashscope-result.oss-cn-beijing.aliyuncs.com/test.wav' },
        extra_info: { audio_length: 1000 },
      } });
    });
    const result = await generate(voice);
    assert.equal(result.status, 201);
    assert.equal(result.data.billing.status, 'settled');
    assert.equal(result.data.billing.actualCostCny, 0.0004 + (alreadyUnlocked ? 0 : 9.9));
    assert.match(result.data.generation.audioUrl, /^\/api\/files\//);
    const transaction = await Transaction.findOne({ operationId: result.data.billing.operationId }).lean();
    assert.equal(transaction.usage.firstVoiceClone, !alreadyUnlocked);
    const current = await Voice.findById(voice._id).lean();
    assert.ok(current.unlockedAt);
    assert.equal(Boolean(current.claimOperationId), false);
  });
}
