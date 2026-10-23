import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

const voiceId = "933563129e564b19a115bedd57b7406a";
const publicVoice = { _id: voiceId, type: "tts", title: "测试音色", state: "trained", visibility: "public", licensed: true, languages: ["zh"] };
const body = { text: "[轻声]你好。", voiceId };
let database, directory, userId, otherUserId, generateFishSpeech, previewFishSpeech, Transaction, Generation, Voice, StoredFile;

test.before(async () => {
  database = await MongoMemoryServer.create();
  directory = await mkdtemp(path.join(os.tmpdir(), "vectaix-fish-"));
  process.env.MONGO_URI = database.getUri();
  process.env.STORAGE_ROOT = directory;
  process.env.FISH_API_KEY = "test-fish-key";
  const { default: dbConnect } = await import("../../lib/db.js");
  await dbConnect();
  const { default: User } = await import("../../models/User.js");
  userId = String((await User.create({ email: "fish@example.test", password: "test-only" }))._id);
  otherUserId = String((await User.create({ email: "other-fish@example.test", password: "test-only" }))._id);
  ({ generateFishSpeech, previewFishSpeech } = await import("../../lib/media/server/operations/fishSpeech.js"));
  ({ default: Transaction } = await import("../../models/CreditTransaction.js"));
  ({ default: Generation } = await import("../../models/FishAudioGeneration.js"));
  ({ default: Voice } = await import("../../models/FishVoice.js"));
  ({ default: StoredFile } = await import("../../models/StoredFile.js"));
});

test.after(async () => {
  await mongoose.disconnect();
  await database?.stop();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("免费合成保存音频和历史、记录零费用及真实字节数，重复操作仅生成一次", async (t) => {
  let syntheses = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (String(url).includes("/model/")) return Response.json(publicVoice);
    syntheses++;
    assert.equal(options.headers.model, "s2.1-pro-free");
    return new Response(Buffer.from("ID3-fish-test"), { headers: { "Content-Type": "audio/mpeg" } });
  });
  const input = { userId, body, clientOperationId: crypto.randomUUID() };
  const result = await generateFishSpeech(input);
  assert.equal(result.status, 201);
  assert.equal(result.data.success, true);
  assert.equal(result.data.generation.model, "s2.1-pro-free");
  assert.match(result.data.generation.audioUrl, /^\/api\/files\//);
  const record = await Transaction.findOne({ operationId: result.data.billing.operationId }).lean();
  assert.equal(record.status, "settled");
  assert.equal(record.actualCostUsd, 0);
  assert.equal(record.actualCostCny, 0);
  assert.equal(record.usage.bytes, Buffer.byteLength(body.text, "utf8"));
  assert.equal(await Generation.countDocuments({ userId }), 1);
  assert.equal(await StoredFile.countDocuments({ userId, ownerType: "audio-generation" }), 1);
  assert.equal((await generateFishSpeech(input)).status, 409);
  assert.equal(syntheses, 1);
});

test("私有音色按用户归属校验，其他用户获得的音色 ID 无法合成", async (t) => {
  await Voice.create({ userId: otherUserId, voiceId, displayName: "他人的音色", status: "trained", consentConfirmedAt: new Date(), sampleFileName: "voice.wav", lastStatusCheckedAt: new Date() });
  let syntheses = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("/model/")) return Response.json({ ...publicVoice, visibility: "private", licensed: false });
    syntheses++;
    return new Response(Buffer.from("ID3-private"), { headers: { "Content-Type": "audio/mpeg" } });
  });
  t.mock.method(console, "error", () => {});
  assert.equal((await generateFishSpeech({ userId, body, clientOperationId: crypto.randomUUID() })).status, 404);
  assert.equal(syntheses, 0);
  const own = await generateFishSpeech({ userId: otherUserId, body, clientOperationId: crypto.randomUUID() });
  assert.equal(own.status, 201);
  assert.equal(own.data.generation.voiceName, "他人的音色");
  assert.equal(syntheses, 1);
});

test("上游明确拒绝释放记录，网络中断标记待核实，两者均不保存生成历史", async (t) => {
  const before = await Generation.countDocuments();
  t.mock.method(console, "error", () => {});
  const upstream = t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("/model/")) return Response.json(publicVoice);
    return Response.json({ message: "limited" }, { status: 429, headers: { "x-request-id": "fish-reject" } });
  });
  const rejected = await generateFishSpeech({ userId, body, clientOperationId: crypto.randomUUID() });
  assert.equal(rejected.status, 429);
  assert.equal(rejected.data.billing.status, "released");
  const record = await Transaction.findOne({ operationId: rejected.data.billing.operationId }).lean();
  assert.deepEqual(record.upstreamRequestIds, ["fish-reject"]);
  upstream.mock.mockImplementation(async (url) => {
    if (String(url).includes("/model/")) return Response.json(publicVoice);
    throw new TypeError("network interrupted");
  });
  const uncertain = await generateFishSpeech({ userId, body, clientOperationId: crypto.randomUUID() });
  assert.equal(uncertain.data.billing.status, "review_required");
  assert.equal(await Generation.countDocuments(), before);
});

test("试听返回音频并记录免费调用，未创建生成历史", async (t) => {
  const before = await Generation.countDocuments();
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (String(url).includes("/model/")) return Response.json({ ...publicVoice, languages: ["en"] });
    assert.equal(JSON.parse(options.body).text, "Hello, this is my voice.");
    return new Response(Buffer.from("ID3-preview"), { headers: { "Content-Type": "audio/mpeg" } });
  });
  const result = await previewFishSpeech({ userId, body: { voiceId }, clientOperationId: crypto.randomUUID() });
  assert.equal(result.status, 200);
  assert.equal(result.mimeType, "audio/mpeg");
  assert.equal(result.audioBuffer.toString(), "ID3-preview");
  assert.equal(result.billing.actualCostUsd, 0);
  assert.equal(await Generation.countDocuments(), before);
});
