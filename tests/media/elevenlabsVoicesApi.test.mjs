import { seedMediaSettings } from '../helpers/media-config.mjs';
import assert from "node:assert/strict";
import test from "node:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

globalThis.AsyncLocalStorage = AsyncLocalStorage;

let database, directory, User, Session, Voice, voicesRoute, voiceRoute, deleteUserAndData;
let workAsyncStorage, workUnitAsyncStorage, RequestCookies;

test.before(async () => {
  database = await MongoMemoryServer.create();
  directory = await mkdtemp(path.join(os.tmpdir(), "vectaix-elevenlabs-voices-"));
  process.env.MONGO_URI = database.getUri();
  process.env.STORAGE_ROOT = directory;
  process.env.ELEVENLABS_API_KEY = "test-elevenlabs-voices-key";
  process.env.APP_SECRETS_KEY = Buffer.alloc(32, 12).toString("base64");
  ({ workAsyncStorage } = await import("next/dist/server/app-render/work-async-storage.external.js"));
  ({ workUnitAsyncStorage } = await import("next/dist/server/app-render/work-unit-async-storage.external.js"));
  ({ RequestCookies } = await import("next/dist/server/web/spec-extension/cookies.js"));
  const { default: dbConnect } = await import("../../lib/db.js");
  await dbConnect();
  await seedMediaSettings({audioKey: 'test-elevenlabs-voices-key'});
  ({ default: User } = await import("../../models/User.js"));
  ({ default: Session } = await import("../../models/Session.js"));
  ({ default: Voice } = await import("../../models/ElevenLabsVoice.js"));
  voicesRoute = await import("../../app/api/media/audio/elevenlabs/voices/route.js");
  voiceRoute = await import("../../app/api/media/audio/elevenlabs/voices/[id]/route.js");
  ({ deleteUserAndData } = await import("../../lib/server/users/deleteUser.js"));
});

test.after(async () => {
  await mongoose.disconnect();
  await database?.stop();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function login(label) {
  const user = await User.create({ email: `${label}@elevenlabs-voices.test`, password: "test-only" });
  const token = randomBytes(32).toString("base64url");
  await Session.create({
    userId: user._id,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + 60000),
  });
  return { userId: String(user._id), token };
}

function call(token, handler, request, profileId) {
  const headers = new Headers(token ? { cookie: `token=${token}` } : {});
  return workAsyncStorage.run({ route: "/api/media/audio/elevenlabs/voices" }, () => workUnitAsyncStorage.run({
    type: "request", phase: "render", cookies: new RequestCookies(headers),
  }, () => handler(request, { params: Promise.resolve({ id: profileId }) })));
}

function wavSample(seconds = 10) {
  const sampleRate = 16000;
  const dataSize = seconds * sampleRate * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < seconds * sampleRate; index++) {
    buffer.writeInt16LE(Math.round(10000 * Math.sin(index * 2 * Math.PI * 220 / sampleRate)), 44 + index * 2);
  }
  return buffer;
}

function cloneRequest({ sample = wavSample(), consent = "true", name = "我的测试声音" } = {}) {
  const form = new FormData();
  form.set("displayName", name);
  form.set("consentConfirmed", consent);
  form.set("sample", new File([sample], "recording.wav", { type: "audio/wav" }));
  return new Request("https://app.test/api/media/audio/elevenlabs/voices", { method: "POST", body: form });
}

function voiceRequest(id, method = "GET") {
  return new Request(`https://app.test/api/media/audio/elevenlabs/voices/${id}`, { method });
}

async function seedVoice(userId, status = "verification_required", createdAt = new Date()) {
  return Voice.create({
    userId,
    voiceId: randomBytes(16).toString("hex"),
    displayName: "本人音色",
    status,
    languages: ["zh"],
    consentConfirmedAt: new Date(),
    sampleFileName: "recording.wav",
    lastStatusCheckedAt: new Date(0),
    createdAt,
  });
}

test("未登录用户无法查看、新建、刷新或删除音色，所有请求均在调用 ElevenLabs 前终止", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("unexpected ElevenLabs request"); });
  const cases = [
    [voicesRoute.GET, new Request("https://app.test/api/media/audio/elevenlabs/voices")],
    [voicesRoute.POST, cloneRequest()],
    [voiceRoute.GET, voiceRequest("profile")],
    [voiceRoute.DELETE, voiceRequest("profile", "DELETE")],
  ];
  for (const [handler, request] of cases) assert.equal((await call(null, handler, request, "profile")).status, 401);
  assert.equal(fetch.mock.callCount(), 0);
});

test("真实 WAV 文件通过校验后以私有 multipart 发送，音色和授权记录持久化到本人账户", async (t) => {
  const member = await login("clone-success");
  const voiceId = randomBytes(16).toString("hex");
  const sample = wavSample();
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://api.elevenlabs.io/v1/voices/add");
    assert.equal(options.method, "POST");
    assert.equal(options.headers["xi-api-key"], "test-elevenlabs-voices-key");
    assert.equal(options.headers["Content-Type"], undefined);
    assert.deepEqual(Buffer.from(await options.body.get("files").arrayBuffer()), sample);
    return Response.json({ voice_id: voiceId, requires_verification: true }, { status: 201 });
  });
  const response = await call(member.token, voicesRoute.POST, cloneRequest({ sample }));
  assert.equal(response.status, 201);
  const data = await response.json();
  const saved = await Voice.findOne({ profileId: data.voice.profileId }).lean();
  assert.equal(String(saved.userId), member.userId);
  assert.equal(saved.voiceId, voiceId);
  assert.equal(saved.status, "verification_required");
  assert.equal(saved.displayName, "我的测试声音");
  assert.equal(saved.sampleFileName, "recording.wav");
  assert.ok(saved.consentConfirmedAt instanceof Date);
  const user = await User.findById(member.userId).select("+voiceCreationLeaseId").lean();
  assert.deepEqual(user.mediaWriteLeases, []);
  assert.equal(user.voiceCreationLeaseId, undefined);
});

test("损坏样本、过短音频和未确认授权返回 400，未产生远程调用或音色记录", async (t) => {
  const member = await login("clone-invalid");
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("unexpected ElevenLabs request"); });
  for (const input of [{ sample: Buffer.from("broken wav") }, { sample: wavSample(1) }, { consent: "false" }]) {
    const response = await call(member.token, voicesRoute.POST, cloneRequest(input));
    assert.equal(response.status, 400);
  }
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(await Voice.countDocuments({ userId: member.userId }), 0);
});

test("音色列表、刷新和删除均按登录用户隔离，知晓他人 profileId 也无法操作", async (t) => {
  const owner = await login("voice-owner");
  const outsider = await login("voice-outsider");
  const voice = await seedVoice(owner.userId, "verification_required", new Date(0));
  const recentVoice = await seedVoice(owner.userId, "trained");
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ voices: [], has_more: false }));
  const ownList = await call(owner.token, voicesRoute.GET, new Request("https://app.test/api/media/audio/elevenlabs/voices"));
  assert.equal(ownList.status, 200);
  const ownData = await ownList.json();
  assert.deepEqual(Object.keys(ownData).sort(), ["success", "voices"]);
  assert.equal(ownData.success, true);
  assert.deepEqual(ownData.voices.filter(item => !item.shared).map((item) => [item.profileId, item.status]), [[recentVoice.profileId, "trained"], [voice.profileId, "verification_required"]]);
  const queriedList = await call(owner.token, voicesRoute.GET, new Request("https://app.test/api/media/audio/elevenlabs/voices?query=other&page=-1&language=invalid!"));
  assert.equal(queriedList.status, 200);
  assert.deepEqual(await queriedList.json(), ownData);
  const otherList = await call(outsider.token, voicesRoute.GET, new Request("https://app.test/api/media/audio/elevenlabs/voices"));
  const otherData = await otherList.json();
  assert.equal(otherData.voices.length, 1);
  assert.equal(otherData.voices[0].shared, true);
  assert.equal(otherData.voices[0].voiceId, '933563129e564b19a115bedd57b7406a');
  for (const method of ["GET", "DELETE"]) {
    const response = await call(outsider.token, voiceRoute[method], voiceRequest(voice.profileId, method), voice.profileId);
    assert.equal(response.status, 404);
  }
  assert.equal(fetch.mock.callCount(), 3);
  assert.ok(await Voice.exists({ _id: voice._id }));
});

test("刷新更新真实本地状态，删除同时移除远程和本人本地音色", async (t) => {
  const member = await login("voice-refresh-delete");
  const voice = await seedVoice(member.userId);
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push(options.method);
    assert.equal(url, `https://api.elevenlabs.io/v1/voices/${voice.voiceId}`);
    if (options.method === "DELETE") return new Response(null, { status: 204 });
    return Response.json({ voice_id: voice.voiceId, name: "我的声音", category: "cloned", verified_languages: [{language: "zh"}, {language: "en"}] });
  });
  const refreshed = await call(member.token, voiceRoute.GET, voiceRequest(voice.profileId), voice.profileId);
  assert.equal(refreshed.status, 200);
  assert.equal((await refreshed.json()).voice.status, "trained");
  const saved = await Voice.findById(voice._id).lean();
  assert.equal(saved.status, "trained");
  assert.deepEqual(saved.languages, ["zh", "en"]);
  assert.ok(saved.lastStatusCheckedAt.getTime() > 0);
  const removed = await call(member.token, voiceRoute.DELETE, voiceRequest(voice.profileId, "DELETE"), voice.profileId);
  assert.equal(removed.status, 200);
  assert.equal(await Voice.exists({ _id: voice._id }), null);
  assert.deepEqual(requests, ["GET", "DELETE"]);
});

test("远程删除失败保留本地记录，远程已经删除时完成本地删除", async (t) => {
  const member = await login("voice-delete-error");
  const voice = await seedVoice(member.userId);
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 503 }));
  const failed = await call(member.token, voiceRoute.DELETE, voiceRequest(voice.profileId, "DELETE"), voice.profileId);
  assert.equal(failed.status, 502);
  assert.ok(await Voice.exists({ _id: voice._id }));
  fetch.mock.mockImplementation(async () => new Response(null, { status: 404 }));
  const missing = await call(member.token, voiceRoute.DELETE, voiceRequest(voice.profileId, "DELETE"), voice.profileId);
  assert.equal(missing.status, 200);
  assert.equal(await Voice.exists({ _id: voice._id }), null);
});

test("删除账号清理本人 ElevenLabs 远程音色、本地记录和会话，保留其他用户音色", async (t) => {
  const member = await login("delete-user");
  const other = await login("keep-user");
  const voice = await seedVoice(member.userId, "trained");
  const otherVoice = await seedVoice(other.userId, "trained");
  await mongoose.connection.collection('fishvoices').insertMany([{ userId: new mongoose.Types.ObjectId(member.userId), voiceId: 'old-owner' }, { userId: new mongoose.Types.ObjectId(other.userId), voiceId: 'old-other' }]);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push(url);
    assert.equal(url, `https://api.elevenlabs.io/v1/voices/${voice.voiceId}`);
    assert.equal(options.method, "DELETE");
    return new Response(null, { status: 204 });
  });
  assert.deepEqual(await deleteUserAndData(member.userId), { success: true });
  assert.equal(await Voice.countDocuments({ userId: member.userId }), 0);
  assert.equal(await Session.countDocuments({ userId: member.userId }), 0);
  assert.equal(await User.exists({ _id: member.userId }), null);
  assert.ok(await Voice.exists({ _id: otherVoice._id }));
  assert.ok(await User.exists({ _id: other.userId }));
  assert.equal(calls.length, 1);
  assert.equal(await mongoose.connection.collection('fishvoices').countDocuments({ userId: new mongoose.Types.ObjectId(member.userId) }), 0);
  assert.equal(await mongoose.connection.collection('fishvoices').countDocuments({ userId: new mongoose.Types.ObjectId(other.userId) }), 1);
});

test("账号删除遇到 ElevenLabs 故障时保留音色和删除围栏，远程已删除后可完成清理", async (t) => {
  const member = await login("delete-user-interrupted");
  const voice = await seedVoice(member.userId, "trained");
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 503 }));
  await assert.rejects(deleteUserAndData(member.userId), { status: 502 });
  assert.ok(await Voice.exists({ _id: voice._id }));
  const pending = await User.findById(member.userId).select("+deletionInProgress").lean();
  assert.equal(pending.deletionInProgress, true);
  assert.equal(await Session.countDocuments({ userId: member.userId }), 0);
  fetch.mock.mockImplementation(async () => new Response(null, { status: 404 }));
  assert.deepEqual(await deleteUserAndData(member.userId), { success: true });
  assert.equal(await Voice.exists({ _id: voice._id }), null);
  assert.equal(await User.exists({ _id: member.userId }), null);
});

test('普通用户可使用管理员共享音色，且只可删除自己的音色', async t => {
  const member = await login('shared-elevenlabs');
  const sharedId = '933563129e564b19a115bedd57b7406a';
  t.mock.method(globalThis, 'fetch', async url => String(url).includes('/v2/voices')
    ? Response.json({ voices: [{ voice_id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', category: 'premade' }], has_more: false })
    : Response.json({ voice_id: sharedId, category: 'cloned', name: '共享声音', labels: { language: 'zh' } }));
  const data = await (await call(member.token, voicesRoute.GET, new Request('https://app.test/api/media/audio/elevenlabs/voices'))).json();
  const shared = data.voices.find(voice => voice.voiceId === sharedId);
  assert.equal(shared.shared, true);
  assert.equal(data.voices.some(voice => voice.builtin && voice.displayName === 'George'), true);
  assert.equal((await call(member.token, voiceRoute.DELETE, voiceRequest(shared.profileId, 'DELETE'), shared.profileId)).status, 404);
  const { resolveElevenLabsVoice } = await import('../../lib/media/server/operations/elevenlabsSpeech.js');
  assert.equal((await resolveElevenLabsVoice({ userId: member.userId, voiceId: sharedId })).voiceName, '共享声音');
});
