import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchSpeech } from '../../lib/server/voice/speech.mjs';

test('朗读使用 Fish Free 已选音色和参数，保留零费用记录', async () => {
  let calls = 0;
  const audio = { provider: 'fish', model: 's2.1-pro-free', voiceId: 'selected', speed: 1.2, volume: 3 };
  const result = await dispatchSpeech({ text: '你好', audio, userId: 'user', clientOperationId: 'id' }, {
    fish: async input => {
      calls++;
      assert.deepEqual(input.body, { ...audio, text: '你好' });
      assert.equal(input.clientOperationId, 'id');
      return { status: 201, data: { success: true, generation: { audioUrl: '/api/files/audio' }, billing: { actualCostCny: 0 } } };
    },
  });
  assert.equal(result.data.audioUrl, '/api/files/audio');
  assert.equal(result.data.billing.actualCostCny, 0);
  assert.equal(calls, 1);
});

test('未选音色、文本超长和上游失败均显示明确错误', async () => {
  await assert.rejects(dispatchSpeech({ text: '你好', audio: { provider: 'unknown' } }, {}), /管理员/);
  await assert.rejects(dispatchSpeech({ text: '字'.repeat(15001) }, {}), /15000/);
  await assert.rejects(dispatchSpeech({ text: '你好', audio: { provider: 'fish', voiceId: 'selected' } }, {
    fish: async () => { throw new Error('upstream unavailable'); },
  }), /upstream unavailable/);
});

test('Qwen 朗读使用独立服务及所选音色，接受超过 Fish 长度上限的文本', async () => {
  const audio = { provider: 'qwen', model: 'qwen-audio-3.1-tts-plus', voiceId: 'longanhuan_v3.1', sampleRate: 24000, volume: 50 };
  const text = '字'.repeat(16000);
  const result = await dispatchSpeech({ text, audio, userId: 'user', clientOperationId: 'qwen-id' }, {
    qwen: async input => {
      assert.deepEqual(input.body, { ...audio, text });
      assert.equal(input.clientOperationId, 'qwen-id');
      return { status: 201, data: { success: true, generation: { audioUrl: '/api/files/qwen-audio' } } };
    },
  });
  assert.equal(result.data.audioUrl, '/api/files/qwen-audio');
  await assert.rejects(dispatchSpeech({ text: '字'.repeat(20001), audio }, {}), { status: 400 });
});
