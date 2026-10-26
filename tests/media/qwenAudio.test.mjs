import assert from 'node:assert/strict';
import test from 'node:test';
import undici from 'undici';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { seedMediaSettings } from '../helpers/media-config.mjs';
import { encryptSecret } from '../../lib/server/security/secrets.mjs';
import { parseQwenSpeechInput } from '../../lib/media/shared/qwenAudio.js';
import { createQwenVoice, getQwenVoice, deleteQwenVoice, synthesizeQwenSpeech } from '../../lib/media/server/qwenAudio.js';
const RealWebSocket = undici.WebSocket;

const model = 'qwen-audio-3.1-tts-plus';
const voiceId = `${model}-vectaix-0123456789abcdef`;
const host = 'ws-2t7yj3g991jc5yo6.ap-southeast-1.maas.aliyuncs.com';
let database, directory;
test.before(async () => {
  database = await MongoMemoryServer.create();
  process.env.MONGO_URI = database.getUri();
  directory = await mkdtemp(path.join(os.tmpdir(), 'vectaix-qwen-'));
  process.env.STORAGE_ROOT = directory;
  const { default: dbConnect } = await import('../../lib/db.js');
  await dbConnect();
});
test.after(async () => { await mongoose.disconnect(); await database.stop(); await rm(directory, { recursive: true, force: true }); });
test.beforeEach(async () => {
  await seedMediaSettings();
  const { default: Settings } = await import('../../models/MediaSettings.js');
  await Settings.updateOne({ _id: 'media' }, { $set: { qwenAudio: {
    enabled: true, baseUrl: `https://${host}`, provider: 'qwen', model,
    voiceId: 'longanhuan_v3.1', format: 'mp3', sampleRate: 24000, speed: 1, volume: 50,
    encryptedApiKey: encryptSecret('test-qwen-key', 'media:qwenAudio'),
  } } });
});

test('Qwen accepts its built-in and cloned voices and validates model-specific parameters', () => {
  assert.equal(parseQwenSpeechInput({ text: '你好', voiceId: 'longanhuan_v3.1' }).sampleRate, 24000);
  assert.equal(parseQwenSpeechInput({ text: '你好', voiceId, format: 'wav', sampleRate: 48000 }).volume, 50);
  for (const invalid of [{ voiceId: 'a'.repeat(32) }, { voiceId: 'cosyvoice-v3-other' }, { volume: 101 }, { volume: 1.5 }, { sampleRate: 32000 }, { model: 'qwen3-tts-flash' }, { text: '字'.repeat(20001) }]) {
    assert.throws(() => parseQwenSpeechInput({ text: '你好', voiceId, ...invalid }), { status: 400 });
  }
});

test('Qwen cloning uploads the actual sample as a Data URI to the Singapore workspace', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, `https://${host}/api/v1/services/audio/tts/customization`);
    assert.equal(options.headers.Authorization, 'Bearer test-qwen-key');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'voice-enrollment');
    assert.deepEqual(body.input, { action: 'create_voice', target_model: model, prefix: 'vectaix', audio: 'data:audio/wav;base64,c2FtcGxl' });
    return Response.json({ output: { voice_id: voiceId }, usage: { count: 1 }, request_id: 'clone-1' });
  });
  const voice = await createQwenVoice({ sample: new File(['sample'], 'sample.wav', { type: 'audio/wav' }) });
  assert.equal(voice._id, voiceId);
  assert.equal(voice.state, 'training');
});

test('Qwen voice queries enforce the target model and translate readiness; deletion uses the same region', async t => {
  let action;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    action = JSON.parse(options.body).input.action;
    return Response.json({ output: action === 'query_voice' ? { status: 'OK', target_model: model } : {}, request_id: 'voice-1' });
  });
  assert.equal((await getQwenVoice(voiceId)).state, 'trained');
  await deleteQwenVoice(voiceId);
  assert.equal(action, 'delete_voice');
});

function socket(t, respond) {
  class MockSocket extends EventTarget {
    readyState = 0;
    constructor(url, init) {
      super();
      assert.equal(url, `wss://${host}/api-ws/v1/inference`);
      assert.equal(init.headers.Authorization, 'Bearer test-qwen-key');
      queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event('open')); });
    }
    send(data) { respond(this, JSON.parse(data)); }
    close() { this.readyState = 3; }
    message(data) { this.dispatchEvent(new MessageEvent('message', { data: typeof data === 'string' || data instanceof ArrayBuffer ? data : JSON.stringify(data) })); }
  }
  undici.WebSocket = function (...args) { return new MockSocket(...args); };
  t.after(() => { undici.WebSocket = RealWebSocket; });
}

test('Qwen waits for task-started, keeps one task ID, joins audio and uses the final billed characters', async t => {
  const actions = [];
  let taskId;
  socket(t, (ws, command) => {
    actions.push(command.header.action);
    taskId ||= command.header.task_id;
    assert.equal(command.header.task_id, taskId);
    if (command.header.action === 'run-task') {
      assert.equal(command.payload.model, model);
      assert.deepEqual(command.payload.parameters, { text_type: 'PlainText', voice: 'longanhuan_v3.1', format: 'mp3', sample_rate: 24000, volume: 50, rate: 1, pitch: 1 });
      queueMicrotask(() => ws.message({ header: { event: 'task-started', task_id: taskId }, payload: {} }));
    } else if (command.header.action === 'continue-task') {
      assert.equal(command.payload.input.text, '你好。世界。');
    } else if (command.header.action === 'finish-task') queueMicrotask(() => {
      ws.message(new Uint8Array([73, 68, 51]).buffer);
      ws.message({ header: { event: 'result-generated', task_id: taskId }, payload: { usage: { characters: 3 } } });
      ws.message(new Uint8Array([1, 2, 3]).buffer);
      ws.message({ header: { event: 'task-finished', task_id: taskId, attributes: { request_uuid: 'tts-1' } }, payload: { usage: { characters: 6 } } });
    });
  });
  const result = await synthesizeQwenSpeech({ text: '你好。世界。', voiceId: 'longanhuan_v3.1' });
  assert.deepEqual(actions, ['run-task', 'continue-task', 'finish-task']);
  assert.deepEqual(result.audioBuffer, Buffer.from([73, 68, 51, 1, 2, 3]));
  assert.equal(result.characters, 6);
  assert.equal(result.requestId, 'tts-1');
});

test('Qwen rejects incomplete audio and task failure and respects cancellation before dispatch', async t => {
  socket(t, (ws, command) => queueMicrotask(() => ws.message({ header: { task_id: command.header.task_id, event: 'task-failed', error_code: 'InvalidParameter', error_message: 'invalid voice' }, payload: {} })));
  await assert.rejects(synthesizeQwenSpeech({ text: '你好', voiceId }), { upstreamRejected: true });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(synthesizeQwenSpeech({ text: '你好', voiceId }, { signal: controller.signal }), { name: 'AbortError' });
  socket(t, (ws, command) => queueMicrotask(() => ws.message({ header: { task_id: command.header.task_id, event: 'task-finished' }, payload: { usage: { characters: 2 } } })));
  await assert.rejects(synthesizeQwenSpeech({ text: '你好', voiceId }), /音频或计费用量不完整/);
  socket(t, ws => queueMicrotask(() => ws.dispatchEvent(new Event('close'))));
  await assert.rejects(synthesizeQwenSpeech({ text: '你好', voiceId }), /连接提前结束/);
});

test('Qwen settings keep Fish credentials separate and select Qwen for chat without exposing secrets', async () => {
  const { saveMediaSettings, getAgentMediaSettings, getMediaConnection } = await import('../../lib/server/media/settings.js');
  const result = await saveMediaSettings({ audioProvider: 'qwen', qwenAudio: { enabled: true, apiKey: 'updated-qwen-key' } });
  assert.equal(result.qwenAudio.hasApiKey, true);
  assert.equal(result.audio.hasApiKey, true);
  assert.ok(!JSON.stringify(result).includes('updated-qwen-key'));
  assert.ok(!JSON.stringify(result).includes('encryptedApiKey'));
  assert.equal((await getAgentMediaSettings()).audio.provider, 'qwen');
  assert.equal((await getMediaConnection('audio')).apiKey, 'test-fish-key');
  assert.equal((await getMediaConnection('qwenAudio')).apiKey, 'updated-qwen-key');
  await assert.rejects(saveMediaSettings({ qwenAudio: { baseUrl: 'https://ws-example.cn-beijing.maas.aliyuncs.com', apiKey: 'new-key' } }), { status: 400 });
});

test('Qwen synthesis saves audio and history, records upstream CNY usage, and prevents duplicate synthesis', async t => {
  const { default: User } = await import('../../models/User.js');
  const { default: Transaction } = await import('../../models/CreditTransaction.js');
  const { default: Generation } = await import('../../models/QwenAudioGeneration.js');
  const { default: StoredFile } = await import('../../models/StoredFile.js');
  const { generateQwenSpeech } = await import('../../lib/media/server/operations/qwenSpeech.js');
  const userId = String((await User.create({ email: 'qwen-generate@test.local', password: 'test-only' }))._id);
  let requests = 0;
  socket(t, (ws, command) => {
    const task_id = command.header.task_id;
    if (command.header.action === 'run-task') {
      requests++;
      queueMicrotask(() => ws.message({ header: { event: 'task-started', task_id }, payload: {} }));
    } else if (command.header.action === 'finish-task') queueMicrotask(() => {
      ws.message(new Uint8Array([73, 68, 51, 1]).buffer);
      ws.message({ header: { event: 'task-finished', task_id, attributes: { request_uuid: 'generate-1' } }, payload: { usage: { characters: 5 } } });
    });
  });
  const options = { userId, body: { text: '你好', voiceId: 'longanhuan_v3.1' }, clientOperationId: crypto.randomUUID() };
  const result = await generateQwenSpeech(options);
  assert.equal(result.status, 201);
  assert.equal(result.data.generation.model, model);
  assert.equal(result.data.generation.characters, 5);
  assert.match(result.data.generation.audioUrl, /^\/api\/files\//);
  const transaction = await Transaction.findOne({ operationId: result.data.billing.operationId }).lean();
  assert.equal(transaction.provider, 'qwen');
  assert.equal(transaction.status, 'settled');
  assert.ok(Math.abs(transaction.actualCostCny - 0.001095) < 1e-12);
  assert.equal(transaction.usage.characters, 5);
  assert.equal(await Generation.countDocuments({ userId }), 1);
  assert.equal(await StoredFile.countDocuments({ userId, ownerType: 'audio-generation' }), 1);
  t.mock.method(console, 'error', () => {});
  assert.equal((await generateQwenSpeech(options)).status, 409);
  assert.equal(requests, 1);
});

test('Qwen cloning enforces local ownership and model readiness before synthesis or billing', async t => {
  const { default: Voice } = await import('../../models/QwenVoice.js');
  const { default: User } = await import('../../models/User.js');
  const { default: Transaction } = await import('../../models/CreditTransaction.js');
  const { generateQwenSpeech, previewQwenSpeech, resolveQwenVoice } = await import('../../lib/media/server/operations/qwenSpeech.js');
  const owner = await User.create({ email: 'qwen-owner@test.local', password: 'test-only' });
  const outsider = await User.create({ email: 'qwen-outsider@test.local', password: 'test-only' });
  await Voice.create({ userId: owner._id, voiceId, displayName: '我的 Qwen 声音', status: 'training', consentConfirmedAt: new Date(), sampleFileName: 'voice.wav', lastStatusCheckedAt: new Date() });
  let fetched = 0;
  t.mock.method(console, 'error', () => {});
  let status = 'DEPLOYING';
  t.mock.method(globalThis, 'fetch', async () => { fetched++; return Response.json({ output: { target_model: model, status } }); });
  const before = await Transaction.countDocuments();
  for (const execute of [generateQwenSpeech, previewQwenSpeech]) {
    assert.equal((await execute({ userId: String(outsider._id), body: { text: '你好', voiceId }, clientOperationId: crypto.randomUUID() })).status, 404);
    assert.equal((await execute({ userId: String(owner._id), body: { text: '你好', voiceId }, clientOperationId: crypto.randomUUID() })).status, 409);
  }
  assert.equal(fetched, 2);
  assert.equal(await Transaction.countDocuments(), before);
  const { saveMediaSettings } = await import('../../lib/server/media/settings.js');
  await saveMediaSettings({ audioProvider: 'qwen', qwenAudio: { voiceId } });
  status = 'OK';
  assert.equal((await resolveQwenVoice({ userId: String(outsider._id), voiceId })).voiceName, '我的 Qwen 声音');
});

test('Qwen releases rejected operations and marks interrupted or incomplete synthesis for cost review without saving audio', async t => {
  const { default: User } = await import('../../models/User.js');
  const { default: Generation } = await import('../../models/QwenAudioGeneration.js');
  const { generateQwenSpeech } = await import('../../lib/media/server/operations/qwenSpeech.js');
  const userId = String((await User.create({ email: 'qwen-errors@test.local', password: 'test-only' }))._id);
  t.mock.method(console, 'error', () => {});
  let mode = 'reject';
  socket(t, (ws, command) => queueMicrotask(() => {
    const task_id = command.header.task_id;
    if (mode === 'reject') ws.message({ header: { task_id, event: 'task-failed', error_code: 'InvalidParameter' }, payload: {} });
    else if (mode === 'disconnect') ws.dispatchEvent(new Event('close'));
    else if (command.header.action === 'run-task') ws.message({ header: { task_id, event: 'task-started' }, payload: {} });
    else if (command.header.action === 'finish-task') {
      ws.message(new Uint8Array([73, 68, 51]).buffer);
      ws.message({ header: { task_id, event: 'task-finished' }, payload: {} });
    }
  }));
  for (const [scenario, expected] of [['reject', 'released'], ['disconnect', 'review_required'], ['missingUsage', 'review_required']]) {
    mode = scenario;
    const result = await generateQwenSpeech({ userId, body: { text: '你好', voiceId: 'longanhuan_v3.1' }, clientOperationId: crypto.randomUUID() });
    assert.equal(result.data.success, false);
    assert.equal(result.data.billing.status, expected);
  }
  assert.equal(await Generation.countDocuments({ userId }), 0);
});

test('Qwen closes the underlying socket even when the server never acknowledges the close handshake', async t => {
  const { createServer } = await import('node:http');
  const server = createServer();
  const connections = new Set();
  let closed = false;
  function frame(opcode, input) {
    const data = Buffer.from(input), header = data.length < 126 ? Buffer.from([0x80 | opcode, data.length]) : Buffer.from([0x80 | opcode, 126, data.length >> 8, data.length & 255]);
    return Buffer.concat([header, data]);
  }
  server.on('upgrade', (request, connection) => {
    connections.add(connection);
    connection.once('end', () => { closed = true; });
    connection.once('close', () => { closed = true; connections.delete(connection); });
    assert.equal(request.headers.authorization, 'Bearer test-qwen-key');
    const accept = crypto.createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    connection.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let pending = Buffer.alloc(0);
    connection.on('data', data => {
      pending = Buffer.concat([pending, data]);
      while (pending.length >= 2) {
        const opcode = pending[0] & 15, marker = pending[1] & 127;
        if (marker === 127) throw new Error('unexpected large frame');
        const length = marker === 126 ? pending.length >= 4 ? pending.readUInt16BE(2) : Infinity : marker;
        const offset = marker === 126 ? 4 : 2;
        if (pending.length < offset + 4 + length) return;
        const mask = pending.subarray(offset, offset + 4), payload = Buffer.from(pending.subarray(offset + 4, offset + 4 + length));
        pending = pending.subarray(offset + 4 + length);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
        if (opcode !== 1) continue;
        const command = JSON.parse(payload.toString()), task_id = command.header.task_id;
        if (command.header.action === 'run-task') connection.write(frame(1, JSON.stringify({ header: { task_id, event: 'task-started' }, payload: {} })));
        if (command.header.action === 'finish-task') {
          connection.write(frame(2, Buffer.from('ID3-audio')));
          connection.write(frame(1, JSON.stringify({ header: { task_id, event: 'task-finished' }, payload: { usage: { characters: 2 } } })));
        }
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.mock.method(undici, 'WebSocket', function (_url, options) { return new RealWebSocket(`ws://127.0.0.1:${server.address().port}`, options); });
  try {
    const result = await synthesizeQwenSpeech({ text: '你好', voiceId: 'longanhuan_v3.1' });
    assert.equal(result.audioBuffer.toString(), 'ID3-audio');
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(closed, true);
  } finally {
    for (const connection of connections) connection.destroy();
    await new Promise(resolve => server.close(resolve));
  }
});
