import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
const { default: MediaSettings } = await import('../../models/MediaSettings.js');
import { seedMediaSettings } from '../helpers/media-config.mjs';
let database;
test.before(async () => {
  database = await MongoMemoryServer.create();
  process.env.MONGO_URI = database.getUri();
  const { default: dbConnect } = await import('../../lib/db.js');
  await dbConnect();
});
test.after(async () => { await mongoose.disconnect(); await database.stop(); });
import assert from "node:assert/strict";
import test from "node:test";
import { parseFishSpeechInput } from "../../lib/media/shared/fishAudio.js";
import { buildFishSpeechPayload, createFishVoice, synthesizeFishSpeech } from "../../lib/media/server/fishAudio.js";

const voiceId = "933563129e564b19a115bedd57b7406a";
const input = { text: "[轻声]你好，Fish。", voiceId };

test.beforeEach(async () => { await seedMediaSettings(); });

test("Fish 按官方字段传递自然语言表达、语速和音量", () => {
  const payload = buildFishSpeechPayload({ ...input, speed: 1.25, volume: -5, temperature: 0.4, topP: 0.8 });
  assert.equal(payload.text, input.text);
  assert.equal(payload.reference_id, voiceId);
  assert.equal(payload.top_p, 0.8);
  assert.deepEqual(payload.prosody, { speed: 1.25, volume: -5 });
  assert.equal(payload.sample_rate, 44100);
  assert.equal(payload.model, undefined);
});

test("格式与采样率须匹配，数值参数和音色 ID 严格验证", () => {
  for (const invalid of [
    { format: "mp3", sampleRate: 24000 }, { format: "wav", sampleRate: 48000 },
    { speed: 0 }, { volume: 21 }, { temperature: 2 }, { topP: "0.7" },
    { voiceId: "../../secret" }, { model: "s2.1-pro" }, { text: " " },
  ]) assert.throws(() => parseFishSpeechInput({ ...input, ...invalid }), { status: 400 });
  assert.equal(parseFishSpeechInput({ ...input, format: "wav", sampleRate: 24000 }).sampleRate, 24000);
});

test("合成显式指定免费模型，保留音频并按 UTF-8 字节记录用量", async (t) => {
  let dispatched = 0, complete = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://api.fish.audio/v1/tts");
    assert.equal(options.headers.model, "s2.1-pro-free");
    assert.equal(options.headers.Authorization, "Bearer test-fish-key");
    assert.equal(options.redirect, "error");
    assert.equal(JSON.parse(options.body).reference_id, voiceId);
    return new Response(new Uint8Array([73, 68, 51, 1]), { headers: { "Content-Type": "audio/mpeg", "x-request-id": "fish-test" } });
  });
  const result = await synthesizeFishSpeech(input, { onRequestDispatched: () => dispatched++, onUpstreamComplete: () => complete++ });
  assert.equal(result.bytes, Buffer.byteLength(input.text, "utf8"));
  assert.ok(result.bytes > result.characters);
  assert.deepEqual(result.audioBuffer, Buffer.from([73, 68, 51, 1]));
  assert.equal(result.requestId, "fish-test");
  assert.equal(dispatched, 1);
  assert.equal(complete, 1);
});

test("复刻上传真实 multipart 文件，保持音色私有且关闭附加试听生成", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://api.fish.audio/model");
    assert.equal(options.headers["Content-Type"], undefined);
    assert.equal(options.body.get("visibility"), "private");
    assert.equal(options.body.get("train_mode"), "fast");
    assert.equal(options.body.get("generate_sample"), "false");
    assert.equal(options.body.get("voices").name, "sample.wav");
    return Response.json({ _id: voiceId, type: "tts", state: "trained" }, { status: 201 });
  });
  const result = await createFishVoice({ displayName: "我的声音", sample: new File(["sample"], "sample.wav") });
  assert.equal(result._id, voiceId);
});

test("明确拒绝带回请求编号，成功状态的非音频响应也会报错", async (t) => {
  const upstream = t.mock.method(globalThis, "fetch", async () => Response.json({ private: "secret" }, { status: 429, headers: { "x-request-id": "fish-limit" } }));
  await assert.rejects(synthesizeFishSpeech(input), { status: 429, requestId: "fish-limit", upstreamRejected: true });
  upstream.mock.mockImplementation(async () => Response.json({ error: "not audio" }));
  await assert.rejects(synthesizeFishSpeech(input), /并非音频/);
});

test("已取消的请求和缺失密钥在发出网络请求前终止", async (t) => {
  const upstream = t.mock.method(globalThis, "fetch", () => { throw new Error("unexpected fetch"); });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(synthesizeFishSpeech(input, { signal: controller.signal }), { name: "AbortError" });
  await MediaSettings.updateOne({ _id: 'media' }, { $unset: { 'audio.encryptedApiKey': '' } });
  await assert.rejects(synthesizeFishSpeech(input), { status: 503, code: "NOT_CONFIGURED" });
  assert.equal(upstream.mock.callCount(), 0);
});
