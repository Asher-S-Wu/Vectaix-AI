import assert from 'node:assert/strict';
import test from 'node:test';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { seedMediaSettings } from '../helpers/media-config.mjs';
import { parseElevenLabsSpeechInput } from '../../lib/media/shared/elevenlabsAudio.js';
import { buildElevenLabsSpeechPayload, createElevenLabsVoice, synthesizeElevenLabsSpeech, listElevenLabsDefaultVoices } from '../../lib/media/server/elevenlabsAudio.js';
const { default: MediaSettings } = await import('../../models/MediaSettings.js');

let database;
const voiceId = 'JBFqnCBsd6RMkjVDRZzb';
const input = { text: '你好，欢迎回来。', voiceId };
test.before(async () => {
  database = await MongoMemoryServer.create();
  process.env.MONGO_URI = database.getUri();
  const { default: dbConnect } = await import('../../lib/db.js');
  await dbConnect();
});
test.after(async () => { await mongoose.disconnect(); await database?.stop(); });
test.beforeEach(async () => { await seedMediaSettings(); });

test('语音参数按 ElevenLabs 官方字段发送，移除旧服务的温度和音量参数', () => {
  const payload = buildElevenLabsSpeechPayload({ ...input, speed: 1.1, stability: 0.6, similarityBoost: 0.8, style: 0.2, useSpeakerBoost: false });
  assert.deepEqual(payload, { text: input.text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.6, similarity_boost: 0.8, style: 0.2, speed: 1.1, use_speaker_boost: false }, apply_text_normalization: 'auto' });
});
test('校验音色、长度、格式、采样率和语速边界', () => {
  for (const invalid of [{ voiceId: '../../secret' }, { text: '字'.repeat(10001) }, { speed: 0.6 }, { speed: 1.3 }, { format: 'mp3', sampleRate: 24000 }, { stability: 1.1 }, { similarityBoost: '0.7' }, { useSpeakerBoost: 'yes' }, { model: 's2.1-pro-free' }]) {
    assert.throws(() => parseElevenLabsSpeechInput({ ...input, ...invalid }), { status: 400 });
  }
  assert.equal(parseElevenLabsSpeechInput({ ...input, format: 'wav', sampleRate: 24000 }).sampleRate, 24000);
});
test('使用 xi-api-key 调用官方接口，保留请求编号和上游计费字符数', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`);
    assert.equal(options.headers['xi-api-key'], 'test-elevenlabs-key');
    assert.equal(options.redirect, 'error');
    assert.equal(JSON.parse(options.body).model_id, 'eleven_multilingual_v2');
    return new Response(Buffer.from('ID3-test'), { headers: { 'content-type': 'audio/mpeg', 'request-id': 'eleven-test', 'character-cost': '6' } });
  });
  const result = await synthesizeElevenLabsSpeech(input);
  assert.equal(result.characters, 6);
  assert.equal(result.bytes, Buffer.byteLength(input.text, 'utf8'));
  assert.equal(result.requestId, 'eleven-test');
  assert.equal(result.audioBuffer.toString(), 'ID3-test');
});
test('PCM 转为标准 WAV，文件头与所选采样率和音频长度匹配', async t => {
  t.mock.method(globalThis, 'fetch', async url => {
    assert.ok(String(url).endsWith('output_format=pcm_24000'));
    return new Response(Buffer.from([0, 1, 2, 3]), { headers: { 'content-type': 'application/octet-stream', 'character-cost': '2' } });
  });
  const { audioBuffer, mimeType } = await synthesizeElevenLabsSpeech({ ...input, format: 'wav', sampleRate: 24000 });
  assert.equal(mimeType, 'audio/wav');
  assert.equal(audioBuffer.toString('ascii', 0, 4), 'RIFF');
  assert.equal(audioBuffer.readUInt32LE(24), 24000);
  assert.equal(audioBuffer.readUInt32LE(40), 4);
  assert.equal(audioBuffer.length, 48);
});
test('克隆上传真实文件，保留需要本人验证的状态', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.elevenlabs.io/v1/voices/add');
    assert.equal(options.body.get('name'), '我的声音');
    assert.equal(options.body.get('files').name, 'sample.wav');
    assert.equal(options.body.get('visibility'), null);
    assert.equal(options.headers['Content-Type'], undefined);
    return Response.json({ voice_id: voiceId, requires_verification: true });
  });
  const result = await createElevenLabsVoice({ displayName: '我的声音', sample: new File(['sample'], 'sample.wav') });
  assert.equal(result.voice_id, voiceId);
  assert.equal(result.requires_verification, true);
});
test('官方声音库读取完整分页，限定系统音色', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('voice_type'), 'default');
    calls++;
    return Response.json({ voices: [{ voice_id: calls === 1 ? voiceId : 'EXAVITQu4vr4xnSDxMaL', name: '系统声音' }], has_more: calls === 1, next_page_token: calls === 1 ? 'next' : null });
  });
  assert.equal((await listElevenLabsDefaultVoices()).length, 2);
  assert.equal(calls, 2);
});
test('明确拒绝保留请求编号，不重试；缺失用量和非音频响应进入报错', async t => {
  const upstream = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 429, headers: { 'request-id': 'eleven-limit' } }));
  await assert.rejects(synthesizeElevenLabsSpeech(input), { status: 429, requestId: 'eleven-limit', upstreamRejected: true });
  assert.equal(upstream.mock.callCount(), 1);
  upstream.mock.mockImplementation(async () => Response.json({ secret: 'private' }));
  await assert.rejects(synthesizeElevenLabsSpeech(input), /并非音频/);
  upstream.mock.mockImplementation(async () => new Response('ID3', { headers: { 'content-type': 'audio/mpeg' } }));
  await assert.rejects(synthesizeElevenLabsSpeech(input), /计费用量/);
});
test('取消和缺失密钥均在网络请求前终止', async t => {
  const upstream = t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected fetch'); });
  await assert.rejects(synthesizeElevenLabsSpeech(input, { signal: AbortSignal.abort() }), { name: 'AbortError' });
  await MediaSettings.updateOne({ _id: 'media' }, { $unset: { 'audio.encryptedApiKey': '' } });
  await assert.rejects(synthesizeElevenLabsSpeech(input), { status: 503 });
  assert.equal(upstream.mock.callCount(), 0);
});
