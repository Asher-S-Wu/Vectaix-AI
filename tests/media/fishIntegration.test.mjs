import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

const voiceId = "933563129e564b19a115bedd57b7406a";
const otherVoiceId = "d96bb87ca040444c81355801bc2ef85a";
const publicVoiceId = "b2ea28f448fa4b709957d0d20b7942cd";
const privateVoice = { _id: voiceId, type: "tts", title: "上游音色名", state: "trained", visibility: "private", licensed: false, languages: ["zh"] };
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
  await Voice.create([
    { userId, voiceId, displayName: "我的声音", status: "trained", consentConfirmedAt: new Date(), sampleFileName: "voice.wav", lastStatusCheckedAt: new Date() },
    { userId: otherUserId, voiceId: otherVoiceId, displayName: "另一位用户的声音", status: "trained", consentConfirmedAt: new Date(), sampleFileName: "voice.wav", lastStatusCheckedAt: new Date() },
  ]);
});

test.after(async () => {
  await mongoose.disconnect();
  await database?.stop();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("免费合成保存音频和历史、记录零费用及真实字节数，重复操作仅生成一次", async (t) => {
  let syntheses = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (String(url).includes("/model/")) {
      assert.equal(url, `https://api.fish.audio/model/${voiceId}`);
      return Response.json(privateVoice);
    }
    syntheses++;
    assert.equal(options.headers.model, "s2.1-pro-free");
    assert.equal(JSON.parse(options.body).reference_id, voiceId);
    return new Response(Buffer.from("ID3-fish-test"), { headers: { "Content-Type": "audio/mpeg" } });
  });
  const input = { userId, body, clientOperationId: crypto.randomUUID() };
  const result = await generateFishSpeech(input);
  assert.equal(result.status, 201);
  assert.equal(result.data.success, true);
  assert.equal(result.data.generation.model, "s2.1-pro-free");
  assert.equal(result.data.generation.voiceName, "我的声音");
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

test("生成和试听先校验本地归属，他人及公共音色 ID 在调用上游与计费前返回 404", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("unexpected Fish request"); });
  t.mock.method(console, "error", () => {});
  const before = [await Transaction.countDocuments(), await Generation.countDocuments(), await StoredFile.countDocuments()];
  for (const execute of [generateFishSpeech, previewFishSpeech]) {
    for (const selectedVoiceId of [otherVoiceId, publicVoiceId]) {
      const result = await execute({ userId, body: { ...body, voiceId: selectedVoiceId }, clientOperationId: crypto.randomUUID() });
      assert.equal(result.status, 404);
      assert.equal(result.data.success, false);
      assert.equal(result.data.billing, undefined);
    }
  }
  assert.equal(fetch.mock.callCount(), 0);
  assert.deepEqual([await Transaction.countDocuments(), await Generation.countDocuments(), await StoredFile.countDocuments()], before);
});

test("生成和试听检查本人音色的上游状态，准备中或已下架的声音不进入合成计费", async (t) => {
  t.mock.method(console, "error", () => {});
  const before = await Transaction.countDocuments();
  let state;
  const fetch = t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url, `https://api.fish.audio/model/${voiceId}`);
    return Response.json({ ...privateVoice, ...state });
  });
  for (const execute of [generateFishSpeech, previewFishSpeech]) {
    for (state of [{ state: "training" }, { state: "failed" }, { dmca_taken_down: true }]) {
      const result = await execute({ userId, body, clientOperationId: crypto.randomUUID() });
      assert.equal(result.status, 409);
      assert.equal(result.data.billing, undefined);
    }
  }
  assert.equal(fetch.mock.callCount(), 6);
  assert.equal(await Transaction.countDocuments(), before);
});

test("上游明确拒绝释放记录，网络中断标记待核实，两者均不保存生成历史", async (t) => {
  const before = await Generation.countDocuments();
  t.mock.method(console, "error", () => {});
  const upstream = t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("/model/")) return Response.json(privateVoice);
    return Response.json({ message: "limited" }, { status: 429, headers: { "x-request-id": "fish-reject" } });
  });
  const rejected = await generateFishSpeech({ userId, body, clientOperationId: crypto.randomUUID() });
  assert.equal(rejected.status, 429);
  assert.equal(rejected.data.billing.status, "released");
  const record = await Transaction.findOne({ operationId: rejected.data.billing.operationId }).lean();
  assert.deepEqual(record.upstreamRequestIds, ["fish-reject"]);
  upstream.mock.mockImplementation(async (url) => {
    if (String(url).includes("/model/")) return Response.json(privateVoice);
    throw new TypeError("network interrupted");
  });
  const uncertain = await generateFishSpeech({ userId, body, clientOperationId: crypto.randomUUID() });
  assert.equal(uncertain.data.billing.status, "review_required");
  assert.equal(await Generation.countDocuments(), before);
});

test("试听返回音频并记录免费调用，未创建生成历史", async (t) => {
  const before = await Generation.countDocuments();
  const filesBefore = await StoredFile.countDocuments();
  let languages;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (String(url).includes("/model/")) {
      assert.equal(url, `https://api.fish.audio/model/${otherVoiceId}`);
      return Response.json({ ...privateVoice, _id: otherVoiceId, languages });
    }
    const payload = JSON.parse(options.body);
    assert.equal(payload.reference_id, otherVoiceId);
    assert.equal(payload.text, languages[0] === "zh" ? "你好，这是我的声音。" : "Hello, this is my voice.");
    return new Response(Buffer.from("ID3-preview"), { headers: { "Content-Type": "audio/mpeg" } });
  });
  for (languages of [["zh"], ["en"]]) {
    const result = await previewFishSpeech({ userId: otherUserId, body: { voiceId: otherVoiceId }, clientOperationId: crypto.randomUUID() });
    assert.equal(result.status, 200);
    assert.equal(result.mimeType, "audio/mpeg");
    assert.equal(result.audioBuffer.toString(), "ID3-preview");
    assert.equal(result.billing.actualCostUsd, 0);
    const record = await Transaction.findOne({ operationId: result.billing.operationId }).lean();
    assert.equal(record.status, "settled");
    assert.equal(record.feature, "fish_tts_preview");
    assert.equal(String(record.userId), otherUserId);
  }
  assert.equal(await Generation.countDocuments(), before);
  assert.equal(await StoredFile.countDocuments(), filesBefore);
});
