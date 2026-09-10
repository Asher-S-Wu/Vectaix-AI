import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

test('关闭对话记忆后不读不写，其他账号不能修改对话能力', async () => {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  try {
    const { default: dbConnect } = await import('../../lib/db.js');
    await dbConnect();
    const { default: Conversation } = await import('../../models/Conversation.js');
    const { default: Memory } = await import('../../models/WorkbenchMemory.js');
    const { getMemoryContext, saveMemory } = await import('../../lib/server/workbench/catalog.js');
    const { updateConversationCapabilities } = await import('../../lib/server/settings/capabilities.js');
    const userId = String(new mongoose.Types.ObjectId());
    const conversation = await Conversation.create({ userId });
    await Memory.create({ userId, scope: 'personal', content: '偏好中文' });
    assert.match(await getMemoryContext(userId, null, { conversationId: String(conversation._id) }), /中文/);
    await assert.rejects(updateConversationCapabilities(String(new mongoose.Types.ObjectId()), String(conversation._id), { memoryEnabled: false }));
    await updateConversationCapabilities(userId, String(conversation._id), { memoryEnabled: false });
    assert.equal(await getMemoryContext(userId, null, { conversationId: String(conversation._id) }), '');
    assert.equal(await saveMemory({ userId, content: '不应保存', source: 'automatic', conversationId: String(conversation._id) }), null);
    assert.equal(await Memory.countDocuments({ userId }), 1);
  } finally { await mongoose.disconnect(); await mongo.stop(); }
});
