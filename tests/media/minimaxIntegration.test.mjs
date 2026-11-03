import { seedMediaSettings } from '../helpers/media-config.mjs';
import assert from "node:assert/strict";
import test from "node:test";
import crypto, { createHash, randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

globalThis.AsyncLocalStorage = AsyncLocalStorage;

const systemVoiceId = "Chinese (Mandarin)_News_Anchor";
const englishVoiceId = "English_Graceful_Lady";
const ok = (extra = {}) => Response.json({ base_resp: { status_code: 0, status_msg: "success" }, ...extra });
const speech = (characters = 26, voiceCount) => ok({ data: { audio: Buffer.from("ID3-minimax").toString("hex"), status: 2 }, extra_info: { usage_characters: characters, ...(voiceCount === undefined ? {} : { usage_voice_count: voiceCount }) }, trace_id: "minimax-trace" });
const systemList = () => ok({ system_voice: [{ voice_id: systemVoiceId, voice_name: "新闻女声", description: ["专业播音腔"] }, { voice_id: englishVoiceId, voice_name: "Graceful Lady" }] });
let database, directory, generate, preview, Transaction, Generation, Voice, StoredFile, User, Session, voicesRoute, voiceRoute, deleteUserAndData;
let workAsyncStorage, workUnitAsyncStorage, RequestCookies;

test.before(async () => {
  database = await MongoMemoryServer.create();
  directory = await mkdtemp(path.join(os.tmpdir(), "vectaix-minimax-"));
  process.env.MONGO_URI = database.getUri();
  process.env.STORAGE_ROOT = directory;
  process.env.APP_SECRETS_KEY = Buffer.alloc(32, 13).toString("base64");
  ({ workAsyncStorage } = await import("next/dist/server/app-render/work-async-storage.external.js"));
  ({ workUnitAsyncStorage } = await import("next/dist/server/app-render/work-unit-async-storage.external.js"));
  ({ RequestCookies } = await import("next/dist/server/web/spec-extension/cookies.js"));
  const { default: dbConnect } = await import("../../lib/db.js");
  await dbConnect();
  await seedMediaSettings();
  ({ default: User } = await import("../../models/User.js"));
  ({ default: Session } = await import("../../models/Session.js"));
  ({ generateMiniMaxSpeech: generate, previewMiniMaxSpeech: preview } = await import("../../lib/media/server/operations/minimaxSpeech.js"));
  ({ default: Transaction } = await import("../../models/CreditTransaction.js"));
  ({ default: Generation } = await import("../../models/MiniMaxAudioGeneration.js"));
  ({ default: Voice } = await import("../../models/MiniMaxVoice.js"));
  ({ default: StoredFile } = await import("../../models/StoredFile.js"));
  voicesRoute = await import("../../app/api/media/audio/minimax/voices/route.js");
  voiceRoute = await import("../../app/api/media/audio/minimax/voices/[id]/route.js");
  ({ deleteUserAndData } = await import("../../lib/server/users/deleteUser.js"));
});

test.after(async () => {
  await mongoose.disconnect();
  await database?.stop();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function login(label) {
  const user = await User.create({ email: `${label}@minimax.test`, password: "test-only" });
  const token = randomBytes(32).toString("base64url");
  await Session.create({ userId: user._id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 60000) });
  return { userId: String(user._id), token };
}

function call(token, handler, request, profileId) {
  const headers = new Headers(token ? { cookie: `token=${token}` } : {});
  return workAsyncStorage.run({ route: "/api/media/audio/minimax/voices" }, () => workUnitAsyncStorage.run({
    type: "request", phase: "render", cookies: new RequestCookies(headers),
  }, () => handler(request, { params: Promise.resolve({ id: profileId }) })));
}

function seedVoice(userId, { createdAt = new Date(), activatedAt = null } = {}) {
  return Voice.create({ userId, voiceId: `Vectaix${randomBytes(12).toString("hex")}`, displayName: "我的声音", languages: [], consentConfirmedAt: new Date(), sampleFileName: "voice.wav", needNoiseReduction: false, needVolumeNormalization: false, activatedAt, lastStatusCheckedAt: new Date(), createdAt });
}

function wavSample(seconds = 10) {
  const sampleRate = 16000, dataSize = seconds * sampleRate * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(36 + dataSize, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < seconds * sampleRate; index++) buffer.writeInt16LE(Math.round(10000 * Math.sin(index * 2 * Math.PI * 220 / sampleRate)), 44 + index * 2);
  return buffer;
}

function cloneRequest({ consent = "true", noise = "true", volume = "false", sample = wavSample() } = {}) {
  const form = new FormData();
  form.set("displayName", "我的测试声音"); form.set("consentConfirmed", consent);
  form.set("needNoiseReduction", noise); form.set("needVolumeNormalization", volume);
  form.set("sample", new File([sample], "recording.wav", { type: "audio/wav" }));
  return new Request("https://app.test/api/media/audio/minimax/voices", { method: "POST", body: form });
}

test("复刻音色首次合成按国内价格记录字符费和复刻费，保存音频历史并标记为已激活", async t => {
  const member = await login("first-use");
  const voice = await seedVoice(member.userId);
  let syntheses = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://api.minimax.cn/v1/t2a_v2");
    syntheses++;
    const payload = JSON.parse(options.body);
    assert.equal(payload.voice_setting.voice_id, voice.voiceId);
    assert.equal(payload.voice_setting.emotion, "happy");
    return speech(26, 1);
  });
  const input = { userId: member.userId, body: { text: "今天很开心(laughs)。", voiceId: voice.voiceId, emotion: "happy", speed: 1.2 }, clientOperationId: crypto.randomUUID() };
  const result = await generate(input);
  assert.equal(result.status, 201);
  assert.equal(result.data.generation.model, "speech-2.8-hd");
  assert.equal(result.data.generation.voiceName, "我的声音");
  assert.equal(result.data.generation.emotion, "happy");
  assert.match(result.data.generation.audioUrl, /^\/api\/files\//);
  const record = await Transaction.findOne({ operationId: result.data.billing.operationId }).lean();
  assert.equal(record.status, "settled");
  assert.equal(record.feature, "minimax_tts_generate");
  assert.equal(record.provider, "minimax");
  assert.equal(record.actualCostCny, 26 * 3.5 / 10000 + 9.9);
  assert.equal(record.actualCostUsd, (26 * 3.5 / 10000 + 9.9) / 6.72);
  assert.equal(record.usage.characters, 26);
  assert.equal(record.usage.voiceCount, 1);
  assert.ok((await Voice.findById(voice._id).lean()).activatedAt instanceof Date);
  assert.equal(await Generation.countDocuments({ userId: member.userId }), 1);
  assert.equal(await StoredFile.countDocuments({ userId: member.userId, ownerType: "audio-generation" }), 1);
  assert.equal((await generate(input)).status, 409);
  assert.equal(syntheses, 1);
});

test("系统音色从官方声音库核对名称，试听按音色语言选择示例句且不保存历史", async t => {
  const member = await login("system-voice");
  const texts = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url.endsWith("/v1/get_voice")) return systemList();
    texts.push(JSON.parse(options.body).text);
    return speech(8);
  });
  const result = await generate({ userId: member.userId, body: { text: "大家好", voiceId: systemVoiceId }, clientOperationId: crypto.randomUUID() });
  assert.equal(result.status, 201);
  assert.equal(result.data.generation.voiceName, "新闻女声");
  assert.equal(result.data.billing.actualCostCny, 8 * 3.5 / 10000);
  for (const voiceId of [systemVoiceId, englishVoiceId]) {
    const previewed = await preview({ userId: member.userId, body: { voiceId }, clientOperationId: crypto.randomUUID() });
    assert.equal(previewed.status, 200);
    assert.equal(previewed.audioBuffer.toString(), "ID3-minimax");
    const record = await Transaction.findOne({ operationId: previewed.billing.operationId }).lean();
    assert.equal(record.feature, "minimax_tts_preview");
  }
  assert.deepEqual(texts, ["大家好", "你好，这是我的声音。", "Hello, this is my voice."]);
  assert.equal(await Generation.countDocuments({ userId: member.userId }), 1);
});

test("他人私有音色、未登记音色和已失效音色在调用合成与计费前被拒绝", async t => {
  const member = await login("private-check");
  const other = await login("private-owner");
  const otherVoice = await seedVoice(other.userId);
  const expired = await seedVoice(member.userId, { createdAt: new Date(Date.now() - 8 * 24 * 3600 * 1000) });
  t.mock.method(console, "error", () => {});
  const fetch = t.mock.method(globalThis, "fetch", async url => {
    assert.equal(url, "https://api.minimax.cn/v1/get_voice");
    return systemList();
  });
  const before = await Transaction.countDocuments();
  for (const [voiceId, status] of [[otherVoice.voiceId, 404], ["Vectaix-not-registered", 404], [expired.voiceId, 409]]) {
    for (const execute of [generate, preview]) {
      const result = await execute({ userId: member.userId, body: { text: "你好", voiceId }, clientOperationId: crypto.randomUUID() });
      assert.equal(result.status, status, voiceId);
      assert.equal(result.data.billing, undefined);
    }
  }
  assert.equal(await Transaction.countDocuments(), before);
  assert.equal(fetch.mock.callCount(), 2);
});

test("官方列表中带尾部空格的系统音色使用有效编号展示、校验和试听", async t => {
  const member = await login("system-voice-whitespace");
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url.endsWith("/v1/get_voice")) return ok({ system_voice: [{ voice_id: "Santa_Claus ", voice_name: "Santa Claus" }] });
    assert.equal(JSON.parse(options.body).voice_setting.voice_id, "Santa_Claus");
    return speech(18);
  });
  const listed = await (await call(member.token, voicesRoute.GET, new Request("https://app.test/api/media/audio/minimax/voices"))).json();
  const builtin = listed.voices.find(voice => voice.builtin);
  assert.equal(builtin.voiceId, "Santa_Claus");
  for (const voiceId of [builtin.voiceId, "Santa_Claus "]) {
    const result = await preview({ userId: member.userId, body: { voiceId }, clientOperationId: crypto.randomUUID() });
    assert.equal(result.status, 200);
    assert.equal(result.audioBuffer.toString(), "ID3-minimax");
  }
});

test("管理员共享的默认音色可供其他用户使用", async t => {
  const admin = await login("share-admin");
  const member = await login("share-member");
  const voice = await seedVoice(admin.userId, { activatedAt: new Date() });
  const MediaSettings = (await import("../../models/MediaSettings.js")).default;
  await MediaSettings.updateOne({ _id: "media" }, { $set: { "minimaxAudio.voiceId": voice.voiceId } });
  t.after(() => seedMediaSettings());
  t.mock.method(globalThis, "fetch", async url => url.endsWith("/v1/get_voice") ? systemList() : speech(4));
  const result = await generate({ userId: member.userId, body: { text: "你好", voiceId: voice.voiceId }, clientOperationId: crypto.randomUUID() });
  assert.equal(result.status, 201);
  assert.equal(result.data.generation.voiceName, "我的声音");
  const listed = await (await call(member.token, voicesRoute.GET, new Request("https://app.test/api/media/audio/minimax/voices"))).json();
  assert.equal(listed.voices.find(item => item.voiceId === voice.voiceId).shared, true);
});

test("上游明确拒绝释放费用记录，未知错误标记待核实，均不保存历史", async t => {
  const member = await login("upstream-errors");
  const voice = await seedVoice(member.userId, { activatedAt: new Date() });
  t.mock.method(console, "error", () => {});
  const upstream = t.mock.method(globalThis, "fetch", async () => Response.json({ base_resp: { status_code: 1026, status_msg: "sensitive" }, trace_id: "minimax-reject" }));
  const body = { text: "你好", voiceId: voice.voiceId };
  const rejected = await generate({ userId: member.userId, body, clientOperationId: crypto.randomUUID() });
  assert.equal(rejected.status, 400);
  assert.match(rejected.data.message, /安全审核/);
  assert.equal(rejected.data.billing.status, "released");
  assert.deepEqual((await Transaction.findOne({ operationId: rejected.data.billing.operationId }).lean()).upstreamRequestIds, ["minimax-reject"]);
  upstream.mock.mockImplementation(async () => Response.json({ base_resp: { status_code: 1000 } }));
  const uncertain = await generate({ userId: member.userId, body, clientOperationId: crypto.randomUUID() });
  assert.equal(uncertain.data.billing.status, "review_required");
  assert.equal(await Generation.countDocuments({ userId: member.userId }), 0);
});

test("声音库合并本人复刻音色与系统音色，未登录请求在调用 MiniMax 前终止", async t => {
  const member = await login("voice-list");
  const voice = await seedVoice(member.userId);
  const fetch = t.mock.method(globalThis, "fetch", async () => systemList());
  for (const [handler, request] of [[voicesRoute.GET, new Request("https://app.test/api/media/audio/minimax/voices")], [voicesRoute.POST, cloneRequest()], [voiceRoute.GET, new Request("https://app.test/x")], [voiceRoute.DELETE, new Request("https://app.test/x", { method: "DELETE" })]]) {
    assert.equal((await call(null, handler, request, "profile")).status, 401);
  }
  assert.equal(fetch.mock.callCount(), 0);
  const data = await (await call(member.token, voicesRoute.GET, new Request("https://app.test/api/media/audio/minimax/voices"))).json();
  assert.equal(data.voices[0].profileId, voice.profileId);
  assert.equal(data.voices[0].status, "pending_activation");
  assert.ok(new Date(data.voices[0].expiresAt) > new Date());
  const builtin = data.voices.find(item => item.voiceId === systemVoiceId);
  assert.deepEqual([builtin.builtin, builtin.displayName, builtin.description, builtin.languages], [true, "新闻女声", "专业播音腔", ["zh"]]);
});

test("试听建立连接超时时释放预留费用，返回连接超时提示", async t => {
  const member = await login("connect-timeout");
  const voice = await seedVoice(member.userId, { activatedAt: new Date() });
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("fetch failed", { cause: Object.assign(new Error("Connect Timeout Error"), { code: "UND_ERR_CONNECT_TIMEOUT" }) });
  });
  const result = await preview({ userId: member.userId, body: { voiceId: voice.voiceId }, clientOperationId: crypto.randomUUID() });
  assert.equal(result.status, 504);
  assert.match(result.data.message, /连接.*超时/);
  assert.equal(result.data.billing.status, "released");
  const transaction = await Transaction.findOne({ operationId: result.data.billing.operationId }).lean();
  assert.equal(transaction.status, "released");
  assert.equal((await Voice.findById(voice._id).lean()).activatedAt.getTime(), voice.activatedAt.getTime());
});

test("远程已删除的复刻音色可以清理本地记录和共享配置，其他删除错误保留记录", async t => {
  const member = await login("already-deleted");
  const voice = await seedVoice(member.userId);
  const MediaSettings = (await import("../../models/MediaSettings.js")).default;
  await MediaSettings.updateOne({ _id: "media" }, { $set: { "minimaxAudio.voiceId": voice.voiceId } });
  t.after(() => seedMediaSettings());
  const upstream = t.mock.method(globalThis, "fetch", async () => Response.json({ base_resp: { status_code: 2013, status_msg: "invalid params, voice_type is invalid" } }));
  const request = () => new Request("https://app.test/x", { method: "DELETE" });
  assert.equal((await call(member.token, voiceRoute.DELETE, request(), voice.profileId)).status, 400);
  assert.ok(await Voice.exists({ _id: voice._id }));
  assert.equal((await MediaSettings.findById("media").lean()).minimaxAudio.voiceId, voice.voiceId);
  upstream.mock.mockImplementation(async () => Response.json({ voice_id: "", description: null, created_time: "", base_resp: { status_code: 2013, status_msg: "invalid params, voice_id does not exist" } }));
  assert.equal((await call(member.token, voiceRoute.DELETE, request(), voice.profileId)).status, 200);
  assert.equal(await Voice.exists({ _id: voice._id }), null);
  assert.equal((await MediaSettings.findById("media").lean()).minimaxAudio.voiceId, "");
});

test("复刻接口校验授权和样本后上传，记录降噪选项；失败时不留下本地记录", async t => {
  const member = await login("clone");
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("unexpected MiniMax request"); });
  for (const input of [{ consent: "false" }, { noise: "maybe" }, { sample: wavSample(1) }, { sample: Buffer.from("broken") }]) {
    assert.equal((await call(member.token, voicesRoute.POST, cloneRequest(input))).status, 400);
  }
  assert.equal(fetch.mock.callCount(), 0);
  let cloned;
  fetch.mock.mockImplementation(async (url, options) => {
    if (url.endsWith("/v1/files/upload")) return new Response('{"file":{"file_id":987654321},"base_resp":{"status_code":0}}');
    cloned = JSON.parse(options.body);
    return ok({ input_sensitive: false });
  });
  const response = await call(member.token, voicesRoute.POST, cloneRequest());
  assert.equal(response.status, 201);
  const { voice } = await response.json();
  assert.equal(voice.status, "pending_activation");
  assert.match(cloned.voice_id, /^Vectaix[0-9a-f]{32}$/);
  assert.deepEqual([cloned.file_id, cloned.need_noise_reduction, cloned.need_volume_normalization], [987654321, true, false]);
  const saved = await Voice.findOne({ profileId: voice.profileId }).lean();
  assert.deepEqual([String(saved.userId), saved.voiceId, saved.needNoiseReduction, saved.activatedAt], [member.userId, cloned.voice_id, true, null]);
  const unverified = await login("clone-unverified");
  fetch.mock.mockImplementation(async url => url.endsWith("/v1/files/upload") ? new Response('{"file":{"file_id":1},"base_resp":{"status_code":0}}') : Response.json({ base_resp: { status_code: 2038 } }));
  const denied = await call(unverified.token, voicesRoute.POST, cloneRequest());
  assert.equal(denied.status, 403);
  assert.match((await denied.json()).message, /实名认证/);
  assert.equal(await Voice.countDocuments({ userId: unverified.userId }), 0);
});

test("刷新状态从已激活列表确认音色，删除同时移除远程和本地记录，他人无法操作", async t => {
  const member = await login("refresh-delete");
  const outsider = await login("refresh-outsider");
  const voice = await seedVoice(member.userId);
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push([url.split("/").at(-1), JSON.parse(options.body)]);
    if (url.endsWith("/v1/get_voice")) return ok({ voice_cloning: [{ voice_id: voice.voiceId, created_time: "2026-11-03" }] });
    return Response.json({ base_resp: { status_code: 2054 } });
  });
  for (const method of ["GET", "DELETE"]) {
    assert.equal((await call(outsider.token, voiceRoute[method], new Request("https://app.test/x", { method }), voice.profileId)).status, 404);
  }
  const refreshed = await (await call(member.token, voiceRoute.GET, new Request("https://app.test/x"), voice.profileId)).json();
  assert.equal(refreshed.voice.status, "trained");
  assert.equal(refreshed.voice.expiresAt, null);
  const removed = await call(member.token, voiceRoute.DELETE, new Request("https://app.test/x", { method: "DELETE" }), voice.profileId);
  assert.equal(removed.status, 200);
  assert.equal(await Voice.exists({ _id: voice._id }), null);
  assert.deepEqual(requests, [["get_voice", { voice_type: "voice_cloning" }], ["delete_voice", { voice_type: "voice_cloning", voice_id: voice.voiceId }]]);
});

test("删除账号同时清理本人 MiniMax 远程音色、本地音色与生成记录", async t => {
  const member = await login("delete-account");
  const other = await login("keep-account");
  const voice = await seedVoice(member.userId);
  const otherVoice = await seedVoice(other.userId);
  await Generation.collection.insertOne({ userId: new mongoose.Types.ObjectId(member.userId), generationId: "old" });
  const deleted = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url.includes("api.elevenlabs.io")) throw new Error("unexpected ElevenLabs request");
    deleted.push(JSON.parse(options.body).voice_id);
    return ok();
  });
  assert.deepEqual(await deleteUserAndData(member.userId), { success: true });
  assert.deepEqual(deleted, [voice.voiceId]);
  assert.equal(await Voice.countDocuments({ userId: member.userId }), 0);
  assert.equal(await Generation.countDocuments({ userId: member.userId }), 0);
  assert.ok(await Voice.exists({ _id: otherVoice._id }));
});
