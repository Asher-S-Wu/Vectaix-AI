import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchSpeech } from '../../lib/server/voice/speech.mjs';

test('聊天朗读使用 ElevenLabs 已选音色并返回可播放音频', async () => {
  const audio = { provider: 'elevenlabs', model: 'eleven_multilingual_v2', voiceId: 'JBFqnCBsd6RMkjVDRZzb', speed: 1.1 };
  const signal = new AbortController().signal;
  const result = await dispatchSpeech({ text: '  你好  ', audio, userId: 'user', clientOperationId: 'id', signal }, {
    elevenlabs: async input => {
      assert.deepEqual(input.body, { ...audio, text: '你好' });
      assert.equal(input.clientOperationId, 'id');
      assert.equal(input.signal, signal);
      return { status: 201, data: { success: true, generation: { audioUrl: '/api/files/audio' }, billing: { actualCostCny: 0.001 } } };
    },
  });
  assert.equal(result.data.audioUrl, '/api/files/audio');
  assert.equal(result.data.billing.actualCostCny, 0.001);
});

test('朗读拒绝旧服务、未配置音色和超长文本，上游失败如实返回', async () => {
  for (const provider of ['fish', 'qwen', 'unknown']) {
    await assert.rejects(dispatchSpeech({ text: '你好', audio: { provider, voiceId: 'selected' } }, {}), /管理员/);
  }
  await assert.rejects(dispatchSpeech({ text: '你好', audio: { provider: 'elevenlabs' } }, {}), /管理员/);
  await assert.rejects(dispatchSpeech({ text: '字'.repeat(10001) }, {}), /10000/);
  const failure = { status: 429, data: { success: false, message: '请求较多' } };
  assert.equal(await dispatchSpeech({ text: '你好', audio: { provider: 'elevenlabs', voiceId: 'selected' } }, { elevenlabs: async () => failure }), failure);
});
