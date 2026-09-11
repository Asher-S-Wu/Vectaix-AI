import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
process.env.MONGO_URI = server.getUri();
const { default: dbConnect } = await import('../../lib/db.js');
const { default: User } = await import('../../models/User.js');
const { default: Transaction, ensureCreditTransactionIndexes } = await import('../../models/CreditTransaction.js');
const { reserveCredits, settleCredits, releaseCredits, claimCreditOperation, getCreditOperation } = await import('../../lib/server/credits/service.js');
const { calculateQwenTtsCost, calculateQwenVoiceCloneCost, createPricingSnapshot } = await import('../../lib/server/credits/pricing.js');
const { DEFAULT_BILLING_SETTINGS } = await import('../../lib/server/credits/constants.js');
await dbConnect();
await ensureCreditTransactionIndexes();
const user = await User.create({ email: 'cost@example.com', password: 'test-only' });
test.after(async () => { await mongoose.disconnect(); await server.stop(); });

test('无积分钱包的普通用户可开始请求，重复请求只生成一条记录', async () => {
  const input = { operationId: 'ordinary', userId: user._id, usage: { requestFingerprint: 'one' } };
  const results = await Promise.all([reserveCredits(input), reserveCredits(input)]);
  assert.equal(results[0].status, 'reserved');
  assert.equal(await Transaction.countDocuments({ operationId: 'ordinary' }), 1);
  assert.equal(Object.hasOwn(results[0], 'reserved'), false);
  await assert.rejects(reserveCredits({ ...input, usage: { requestFingerprint: 'different' } }), /不一致/);
  const claims = await Promise.allSettled([claimCreditOperation('ordinary', 'claim-a'), claimCreditOperation('ordinary', 'claim-b')]);
  assert.equal(claims.filter(result => result.status === 'fulfilled').length, 1);
});

test('按实际人民币花费记录，无倍率或积分取整，重复结算不重复计入', async () => {
  const input = { operationId: 'ordinary', actualCostCny: 12345.000123, actualCostUsd: 1837.0535897321 };
  const results = await Promise.all([settleCredits(input), settleCredits(input)]);
  assert.equal(results[0].actualCostCny, 12345.000123);
  assert.equal(results[1].status, 'settled');
  assert.equal(await Transaction.countDocuments({ operationId: 'ordinary', status: 'settled' }), 1);
  await assert.rejects(settleCredits({ ...input, actualCostCny: 1 }), /不一致/);
  await assert.rejects(releaseCredits('ordinary'), /已经结束/);
  const stored = await User.collection.findOne({ _id: user._id });
  assert.equal(Object.hasOwn(stored, 'creditBalance'), false);
});

test('失败请求记录为零花费，操作不能被其他用户或不同请求复用', async () => {
  await reserveCredits({ operationId: 'failure', userId: user._id, usage: { requestFingerprint: 'failed-request' } });
  const released = await releaseCredits('failure', { reason: '供应商拒绝请求' });
  assert.equal(released.status, 'released');
  assert.equal(released.actualCostCny, 0);
  await assert.rejects(getCreditOperation({ operationId: 'failure', userId: new mongoose.Types.ObjectId(), requestFingerprint: 'failed-request' }), /其他用户/);
  await assert.rejects(settleCredits({ operationId: 'failure' }), /实际人民币/);
});

test('媒体成本保留细小金额和原汇率，价格快照无积分设置', () => {
  assert.equal(calculateQwenVoiceCloneCost(DEFAULT_BILLING_SETTINGS).costCny, 0.0672);
  const cost = calculateQwenTtsCost({ characters: 1 }, DEFAULT_BILLING_SETTINGS);
  assert.equal(cost.costCny, 1.49884 / 10000);
  assert.equal(Object.hasOwn(cost, 'points'), false);
  const snapshot = createPricingSnapshot(DEFAULT_BILLING_SETTINGS);
  assert.equal(snapshot.usdToCny, 6.72);
  assert.equal(Object.hasOwn(snapshot, 'costMultiplier'), false);
});
