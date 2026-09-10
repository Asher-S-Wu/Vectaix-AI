import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

test('通行密钥挑战绑定登录会话，过期或消费后不能重放', async () => {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  try {
    const { consumeChallenge } = await import('../../lib/server/auth/passkeys.js');
    const { default: dbConnect } = await import('../../lib/db.js');
    const { default: Challenge } = await import('../../models/AuthChallenge.js');
    await dbConnect();
    const userId = new mongoose.Types.ObjectId();
    const sessionId = new mongoose.Types.ObjectId();
    const item = await Challenge.create({ userId, sessionId, purpose: 'registration', challenge: 'nonce', expiresAt: new Date(Date.now() + 60000) });
    await assert.rejects(consumeChallenge(String(item._id), 'registration', { userId: String(userId), sessionId: String(new mongoose.Types.ObjectId()) }));
    assert.equal((await consumeChallenge(String(item._id), 'registration', { userId: String(userId), sessionId: String(sessionId) })).challenge, 'nonce');
    await assert.rejects(consumeChallenge(String(item._id), 'registration', { userId: String(userId), sessionId: String(sessionId) }));
    const expired = await Challenge.create({ purpose: 'authentication', challenge: 'old', expiresAt: new Date(0) });
    await assert.rejects(consumeChallenge(String(expired._id), 'authentication'));
  } finally { await mongoose.disconnect(); await mongo.stop(); }
});
