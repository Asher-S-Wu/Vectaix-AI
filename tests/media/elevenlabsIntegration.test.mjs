import { seedMediaSettings } from '../helpers/media-config.mjs';
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
const privateVoice = { voice_id: voiceId, category: "cloned", name: "上游音色名", labels: { language: "zh" } };
const body = { text: "[轻声]你好。", voiceId };
let database, directory, userId, otherUserId, generateElevenLabsSpeech, previewElevenLabsSpeech, Transaction, Generation, Voice, StoredFile;

test.before(async () => {
  database = await MongoMemoryServer.create();
  directory = await mkdtemp(path.join(os.tmpdir(), "vectaix-elevenlabs-"));
  process.env.MONGO_URI = database.getUri();
  process.env.STORAGE_ROOT = directory;
  process.env.ELEVENLABS_API_KEY = "test-elevenlabs-key";
  const { default: dbConnect } = await import("../../lib/db.js");
  await dbConnect();
  await seedMediaSettings({audioKey: 'test-elevenlabs-key'});
  const { default: User } = await import("../../models/User.js");
  userId = String((await User.create({ email: "elevenlabs@example.test", password: "test-only" }))._id);
  otherUserId = String((await User.create({ email: "other-elevenlabs@example.test", password: "test-only" }))._id);
  ({ generateElevenLabsSpeech, previewElevenLabsSpeech } = await import("../../lib/media/server/operations/elevenlabsSpeech.js"));
  ({ default: Transaction } = await import("../../models/CreditTransaction.js"));
  ({ default: Generation } = await import("../../models/ElevenLabsAudioGeneration.js"));
  ({ default: Voice } = await import("../../models/ElevenLabsVoice.js"));
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

test("语音合成保存音频和历史、记录字符费用及真实字节数，重复操作仅生成一次", async (t) => {
  let syntheses = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (String(url).includes("/v1/voices/")) {
      assert.equal(url, `https://api.elevenlabs.io/v1/voices/${voiceId}`);
      return Response.json(privateVoice);
    }
    syntheses++;
    assert.equal(JSON.parse(options.body).model_id, "eleven_multilingual_v2");
    assert.equal(String(url).split("/text-to-speech/")[1].split("?")[0], voiceId);
    return new Response(Buffer.from("ID3-elevenlabs-test"), { headers: { "Content-Type": "audio/mpeg", "character-cost": "8" } });
  });
  const input = { userId, body, clientOperationId: crypto.randomUUID() };
  const result = await generateElevenLabsSpeech(input);
  assert.equal(result.status, 201);
  assert.equal(result.data.success, true);
  assert.equal(result.data.generation.model, "eleven_multilingual_v2");
  assert.equal(result.data.generation.voiceName, "我的声音");
  assert.match(result.data.generation.audioUrl, /^\/api\/files\//);
  const record = await Transaction.findOne({ operationId: result.data.billing.operationId }).lean();
  assert.equal(record.status, "settled");
  assert.equal(record.actualCostUsd, 8 * 0.08 / 1000);
  assert.equal(record.actualCostCny, 8 * 0.08 / 1000 * 6.72);
  assert.equal(record.usage.bytes, Buffer.byteLength(body.text, "utf8"));
  assert.equal(await Generation.countDocuments({ userId }), 1);
  assert.equal(await StoredFile.countDocuments({ userId, ownerType: "audio-generation" }), 1);
  assert.equal((await generateElevenLabsSpeech(input)).status, 409);
  assert.equal(syntheses, 1);
});

test("生成和试听先校验本地归属，他人音色在调用上游与计费前返回 404", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("unexpected ElevenLabs request"); });
  t.mock.method(console, "error", () => {});
  const before = [await Transaction.countDocuments(), await Generation.countDocuments(), await StoredFile.countDocuments()];
  for (const execute of [generateElevenLabsSpeech, previewElevenLabsSpeech]) {
    for (const selectedVoiceId of [otherVoiceId]) {
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
    assert.equal(url, `https://api.elevenlabs.io/v1/voices/${voiceId}`);
    return Response.json({ ...privateVoice, ...state });
  });
  for (const execute of [generateElevenLabsSpeech, previewElevenLabsSpeech]) {
    for (state of [{ voice_verification: { requires_verification: true, is_verified: false } }, { safety_control: "BAN" }, { safety_control: "CAPTCHA" }]) {
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
    if (String(url).includes("/v1/voices/")) return Response.json(privateVoice);
    return Response.json({ message: "limited" }, { status: 429, headers: { "request-id": "elevenlabs-reject" } });
  });
  const rejected = await generateElevenLabsSpeech({ userId, body, clientOperationId: crypto.randomUUID() });
  assert.equal(rejected.status, 429);
  assert.equal(rejected.data.billing.status, "released");
  const record = await Transaction.findOne({ operationId: rejected.data.billing.operationId }).lean();
  assert.deepEqual(record.upstreamRequestIds, ["elevenlabs-reject"]);
  upstream.mock.mockImplementation(async (url) => {
    if (String(url).includes("/v1/voices/")) return Response.json(privateVoice);
    throw new TypeError("network interrupted");
  });
  const uncertain = await generateElevenLabsSpeech({ userId, body, clientOperationId: crypto.randomUUID() });
  assert.equal(uncertain.data.billing.status, "review_required");
  assert.equal(await Generation.countDocuments(), before);
});

test("试听返回音频并记录字符费用，未创建生成历史", async (t) => {
  const before = await Generation.countDocuments();
  const filesBefore = await StoredFile.countDocuments();
  let languages;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (String(url).includes("/v1/voices/")) {
      assert.equal(url, `https://api.elevenlabs.io/v1/voices/${otherVoiceId}`);
      return Response.json({ ...privateVoice, voice_id: otherVoiceId, labels: { language: languages[0] } });
    }
    const payload = JSON.parse(options.body);
    assert.equal(String(url).split("/text-to-speech/")[1].split("?")[0], otherVoiceId);
    assert.equal(payload.text, languages[0] === "zh" ? "你好，这是我的声音。" : "Hello, this is my voice.");
    return new Response(Buffer.from("ID3-preview"), { headers: { "Content-Type": "audio/mpeg", "character-cost": "8" } });
  });
  for (languages of [["zh"], ["en"]]) {
    const result = await previewElevenLabsSpeech({ userId: otherUserId, body: { voiceId: otherVoiceId }, clientOperationId: crypto.randomUUID() });
    assert.equal(result.status, 200);
    assert.equal(result.mimeType, "audio/mpeg");
    assert.equal(result.audioBuffer.toString(), "ID3-preview");
    assert.equal(result.billing.actualCostUsd, 8 * 0.08 / 1000);
    const record = await Transaction.findOne({ operationId: result.billing.operationId }).lean();
    assert.equal(record.status, "settled");
    assert.equal(record.feature, "elevenlabs_tts_preview");
    assert.equal(String(record.userId), otherUserId);
  }
  assert.equal(await Generation.countDocuments(), before);
  assert.equal(await StoredFile.countDocuments(), filesBefore);
});


test('系统音色无需克隆即可生成，未登记的私人音色在计费前被拒绝', async t => {
  const defaultVoiceId = 'JBFqnCBsd6RMkjVDRZzb';
  const hiddenVoiceId = 'EXAVITQu4vr4xnSDxMaL';
  let syntheses = 0;
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async url => {
    if (String(url).includes('/v1/voices/')) {
      const id = String(url).split('/').at(-1);
      return Response.json({ voice_id: id, name: 'George', category: id === defaultVoiceId ? 'premade' : 'cloned' });
    }
    syntheses++;
    return new Response(Buffer.from('ID3-system'), { headers: { 'content-type': 'audio/mpeg', 'character-cost': '2' } });
  });
  const input = { userId, clientOperationId: crypto.randomUUID(), body: { text: '你好', voiceId: defaultVoiceId } };
  const result = await generateElevenLabsSpeech(input);
  assert.equal(result.status, 201);
  assert.equal(result.data.generation.voiceName, 'George');
  const before = await Transaction.countDocuments();
  const rejected = await generateElevenLabsSpeech({ ...input, clientOperationId: crypto.randomUUID(), body: { ...input.body, voiceId: hiddenVoiceId } });
  assert.equal(rejected.status, 404);
  assert.equal(await Transaction.countDocuments(), before);
  assert.equal(syntheses, 1);
});

test('上游成功返回音频却缺少计费字段时标记待核实，不写入生成历史', async t => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async url => String(url).includes('/v1/voices/')
    ? Response.json(privateVoice)
    : new Response(Buffer.from('ID3-no-usage'), { headers: { 'content-type': 'audio/mpeg', 'request-id': 'missing-usage' } }));
  const before = await Generation.countDocuments();
  const result = await generateElevenLabsSpeech({ userId, body, clientOperationId: crypto.randomUUID() });
  assert.equal(result.data.success, false);
  assert.equal(result.data.billing.status, 'review_required');
  assert.equal(await Generation.countDocuments(), before);
  assert.deepEqual((await Transaction.findOne({ operationId: result.data.billing.operationId }).lean()).upstreamRequestIds, ['missing-usage']);
});
