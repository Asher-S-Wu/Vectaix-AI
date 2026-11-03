import assert from 'node:assert/strict';
import test from 'node:test';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { seedMediaSettings } from '../helpers/media-config.mjs';
import { minimaxCloneStatus, parseMiniMaxSpeechInput } from '../../lib/media/shared/minimaxAudio.js';
import { buildMiniMaxSpeechPayload, createMiniMaxVoice, deleteMiniMaxVoice, listMiniMaxVoices, minimaxVoiceLanguages, synthesizeMiniMaxSpeech } from '../../lib/media/server/minimaxAudio.js';
const { default: MediaSettings } = await import('../../models/MediaSettings.js');

let database;
const voiceId = 'Chinese (Mandarin)_News_Anchor';
const input = { text: '今天很开心(laughs)，我们出发吧。', voiceId };
const ok = (extra = {}) => Response.json({ base_resp: { status_code: 0, status_msg: 'success' }, ...extra });
test.before(async () => {
  database = await MongoMemoryServer.create();
  process.env.MONGO_URI = database.getUri();
  const { default: dbConnect } = await import('../../lib/db.js');
  await dbConnect();
});
test.after(async () => { await mongoose.disconnect(); await database?.stop(); });
test.beforeEach(async () => { await seedMediaSettings(); });

test('合成参数按 MiniMax 官方字段发送，自动情绪、无音效和关闭规范化时不附带对应字段', () => {
  assert.deepEqual(buildMiniMaxSpeechPayload(input), {
    model: 'speech-2.8-hd', text: input.text, stream: false, output_format: 'hex',
    voice_setting: { voice_id: voiceId, speed: 1, vol: 1, pitch: 0 },
    audio_setting: { sample_rate: 32000, format: 'mp3', channel: 1, bitrate: 128000 },
    language_boost: 'auto',
  });
  assert.deepEqual(buildMiniMaxSpeechPayload({ ...input, format: 'wav', sampleRate: 24000, speed: 1.5, volume: 2.5, pitch: -3, emotion: 'happy', languageBoost: 'Chinese,Yue', soundEffect: 'robotic', textNormalization: 'quality' }), {
    model: 'speech-2.8-hd', text: input.text, stream: false, output_format: 'hex',
    voice_setting: { voice_id: voiceId, speed: 1.5, vol: 2.5, pitch: -3, emotion: 'happy' },
    audio_setting: { sample_rate: 24000, format: 'wav', channel: 1 },
    language_boost: 'Chinese,Yue', text_normalization_mode: 'quality', voice_modify: { sound_effects: 'robotic' },
  });
});

test('校验音色、长度、格式、采样率、语速、音量、语调和枚举参数', () => {
  for (const invalid of [{ voiceId: '../secret' }, { voiceId: ' ' }, { text: '字'.repeat(10001) }, { speed: 0.4 }, { speed: 2.1 }, { volume: 0 }, { volume: 11 }, { pitch: 13 }, { pitch: 0.5 }, { format: 'flac' }, { sampleRate: 48000 }, { bitrate: 96000 }, { emotion: 'whisper' }, { languageBoost: 'Klingon' }, { soundEffect: 'echo' }, { textNormalization: true }, { model: 'speech-02-hd' }]) {
    assert.throws(() => parseMiniMaxSpeechInput({ ...input, ...invalid }), { status: 400 }, JSON.stringify(invalid));
  }
  for (const id of ['male-qn-qingse', 'Chinese (Mandarin)_Lyrical_Voice', 'moss_audio_ce44fc67-7ce3-11f0-8de5-96e35d26fb85', 'hindi_female_2_v1', 'Vectaix0123456789abcdef0123456789abcdef']) {
    assert.equal(parseMiniMaxSpeechInput({ ...input, voiceId: id }).voiceId, id);
  }
});

test('从音色编号前缀判断语言，供试听选择中英文示例句', () => {
  assert.deepEqual(minimaxVoiceLanguages('Chinese (Mandarin)_News_Anchor'), ['zh']);
  assert.deepEqual(minimaxVoiceLanguages('Cantonese_GentleLady'), ['zh-yue']);
  assert.deepEqual(minimaxVoiceLanguages('English_Graceful_Lady'), ['en']);
  assert.deepEqual(minimaxVoiceLanguages('greek_male_1a_v1'), ['el']);
  assert.deepEqual(minimaxVoiceLanguages('male-qn-qingse'), []);
});

test('使用 Bearer 密钥调用国内版接口，解码十六进制音频并保留计费字符与首次音色费用', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.minimax.cn/v1/t2a_v2');
    assert.equal(options.headers.Authorization, 'Bearer test-minimax-key');
    assert.equal(options.redirect, 'error');
    assert.equal(JSON.parse(options.body).voice_setting.voice_id, voiceId);
    return ok({ data: { audio: Buffer.from('ID3-minimax').toString('hex'), status: 2 }, extra_info: { usage_characters: 26, usage_voice_count: 1 }, trace_id: 'trace-1' });
  });
  const result = await synthesizeMiniMaxSpeech(input);
  assert.equal(result.audioBuffer.toString(), 'ID3-minimax');
  assert.equal(result.mimeType, 'audio/mpeg');
  assert.equal(result.characters, 26);
  assert.equal(result.voiceCount, 1);
  assert.equal(result.requestId, 'trace-1');
  assert.equal(result.bytes, Buffer.byteLength(input.text, 'utf8'));
  t.mock.method(globalThis, 'fetch', async () => ok({ data: { audio: '52494646' }, extra_info: { usage_characters: 4 } }));
  const wav = await synthesizeMiniMaxSpeech({ ...input, format: 'wav' });
  assert.equal(wav.mimeType, 'audio/wav');
  assert.equal(wav.voiceCount, 0);
});

test('业务错误码映射为明确提示，拒绝类错误标记为未计费；未知错误和格式问题进入核实', async t => {
  const upstream = t.mock.method(globalThis, 'fetch', async () => Response.json({ base_resp: { status_code: 1002, status_msg: 'rate limit' }, trace_id: 'trace-limit' }));
  await assert.rejects(synthesizeMiniMaxSpeech(input), { status: 429, requestId: 'trace-limit', upstreamRejected: true, code: 'MINIMAX_1002' });
  assert.equal(upstream.mock.callCount(), 1);
  for (const [code, status, message] of [[1004, 503, /密钥无效/], [1008, 503, /余额不足/], [1026, 400, /安全审核/], [2054, 404, /不存在/], [2038, 403, /实名认证/]]) {
    upstream.mock.mockImplementation(async () => Response.json({ base_resp: { status_code: code } }));
    await assert.rejects(synthesizeMiniMaxSpeech(input), { status, upstreamRejected: true, message });
  }
  upstream.mock.mockImplementation(async () => Response.json({ base_resp: { status_code: 1000 } }));
  await assert.rejects(synthesizeMiniMaxSpeech(input), { status: 502, upstreamRejected: false });
  upstream.mock.mockImplementation(async () => new Response('busy', { status: 503 }));
  await assert.rejects(synthesizeMiniMaxSpeech(input), { status: 502, upstreamRejected: false });
  upstream.mock.mockImplementation(async () => ok({ data: { audio: 'xyz1' }, extra_info: { usage_characters: 2 } }));
  await assert.rejects(synthesizeMiniMaxSpeech(input), /音频数据有误/);
  upstream.mock.mockImplementation(async () => ok({ data: { audio: 'abcd' } }));
  await assert.rejects(synthesizeMiniMaxSpeech(input), /计费用量/);
});

test('取消和缺失密钥均在网络请求前终止', async t => {
  const upstream = t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected fetch'); });
  await assert.rejects(synthesizeMiniMaxSpeech(input, { signal: AbortSignal.abort() }), { name: 'AbortError' });
  await MediaSettings.updateOne({ _id: 'media' }, { $unset: { 'minimaxAudio.encryptedApiKey': '' } });
  await assert.rejects(synthesizeMiniMaxSpeech(input), { status: 503 });
  assert.equal(upstream.mock.callCount(), 0);
});

test('声音复刻先上传样本，再用原样的大整数文件编号调用复刻接口', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push(url);
    if (url.endsWith('/v1/files/upload')) {
      assert.equal(options.body.get('purpose'), 'voice_clone');
      assert.equal(options.body.get('file').name, 'sample.wav');
      assert.equal(options.headers['Content-Type'], undefined);
      return new Response('{"file":{"file_id":12345678901234567890,"bytes":6,"purpose":"voice_clone"},"base_resp":{"status_code":0,"status_msg":"success"}}', { headers: { 'content-type': 'application/json' } });
    }
    assert.equal(url, 'https://api.minimax.cn/v1/voice_clone');
    assert.match(options.body, /^\{"file_id":12345678901234567890,/);
    const body = JSON.parse(options.body);
    assert.equal(body.voice_id, 'Vectaix0123456789abcdef');
    assert.equal(body.need_noise_reduction, true);
    assert.equal(body.need_volume_normalization, false);
    assert.equal(body.text, undefined);
    return ok({ input_sensitive: false, input_sensitive_type: 0, demo_audio: '' });
  });
  const result = await createMiniMaxVoice({ voiceId: 'Vectaix0123456789abcdef', sample: new File(['sample'], 'sample.wav'), needNoiseReduction: true, needVolumeNormalization: false });
  assert.equal(result.voiceId, 'Vectaix0123456789abcdef');
  assert.equal(calls.length, 2);
});

test('复刻样本命中风控或账户未认证时拒绝创建', async t => {
  const upload = () => new Response('{"file":{"file_id":42},"base_resp":{"status_code":0}}');
  t.mock.method(globalThis, 'fetch', async url => url.endsWith('/upload') ? upload() : ok({ input_sensitive: { type: 2 } }));
  await assert.rejects(createMiniMaxVoice({ voiceId: 'Vectaix0123456789', sample: new File(['x'], 'a.mp3'), needNoiseReduction: false, needVolumeNormalization: false }), { status: 400, message: /安全审核/ });
  t.mock.method(globalThis, 'fetch', async url => url.endsWith('/upload') ? upload() : Response.json({ base_resp: { status_code: 2038 } }));
  await assert.rejects(createMiniMaxVoice({ voiceId: 'Vectaix0123456789', sample: new File(['x'], 'a.mp3'), needNoiseReduction: false, needVolumeNormalization: false }), { status: 403, message: /实名认证/ });
});

test('读取系统音色和已激活的复刻音色，删除复刻音色', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/v1/delete_voice')) {
      assert.deepEqual(body, { voice_type: 'voice_cloning', voice_id: 'Vectaix0123456789' });
      return ok({ voice_id: 'Vectaix0123456789' });
    }
    if (body.voice_type === 'system') return ok({ system_voice: [{ voice_id: voiceId, voice_name: '新闻女声', description: ['专业播音腔'] }] });
    return ok({ voice_cloning: null });
  });
  assert.deepEqual((await listMiniMaxVoices('system')).map(voice => voice.voice_name), ['新闻女声']);
  assert.deepEqual(await listMiniMaxVoices('voice_cloning'), []);
  await deleteMiniMaxVoice('Vectaix0123456789');
  t.mock.method(globalThis, 'fetch', async () => ok({ system_voice: [{ voice_id: 'bad"id' }] }));
  await assert.rejects(listMiniMaxVoices('system'), /音色信息有误/);
});

test('复刻音色 7 天内未使用即失效，使用过的音色一直可用', () => {
  const now = Date.parse('2026-11-10T00:00:00Z');
  assert.equal(minimaxCloneStatus({ activatedAt: null, createdAt: '2026-11-04T00:00:00Z' }, now), 'pending_activation');
  assert.equal(minimaxCloneStatus({ activatedAt: null, createdAt: '2026-11-02T00:00:00Z' }, now), 'expired');
  assert.equal(minimaxCloneStatus({ activatedAt: '2026-11-03T00:00:00Z', createdAt: '2026-10-01T00:00:00Z' }, now), 'trained');
});
