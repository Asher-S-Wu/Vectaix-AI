import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRecording} from '../../lib/server/voice/recording.js';
import {dispatchSpeech} from '../../lib/server/voice/speech.mjs';

function wav(seconds=1) { const data=Buffer.alloc(44+16000*2*seconds);data.write('RIFF');data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(16000,24);data.writeUInt32LE(32000,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(data.length-44,40);return data; }
test('真实音频解码为 WAV 并从解码结果确定计费时长',async()=>{
  const result=await normalizeRecording(new File([wav(2)],'recording.wav',{type:'audio/wav'}));
  assert.equal(result.durationSeconds,2);
  assert.equal(result.mimeType,'audio/wav');
  assert.equal(result.buffer.toString('ascii',0,4),'RIFF');
  await assert.rejects(normalizeRecording(new File(['not audio'],'bad.wav',{type:'audio/wav'})),/音频/);
});
test('朗读严格使用已选的付费服务，失败时不切换供应商',async()=>{
  let calls=0;
  const result=await dispatchSpeech({text:'你好',audio:{provider:'qwen',voiceId:'selected'},userId:'user',clientOperationId:'id'},{qwen:async input=>{calls++;assert.equal(input.body.voiceId,'selected');assert.equal(input.body.text,'你好');return {status:201,data:{success:true,generation:{audioUrl:'/api/files/paid'},billing:{chargedPoints:3}}};},minimax:async()=>{throw new Error('unexpected');}});
  assert.equal(result.data.audioUrl,'/api/files/paid');assert.equal(result.data.billing.chargedPoints,3);assert.equal(calls,1);
  await assert.rejects(dispatchSpeech({text:'你好',audio:{provider:'unknown'}},{}),/选择/);
  await assert.rejects(dispatchSpeech({text:'你好',audio:{provider:'qwen',voiceId:'selected'}},{qwen:async()=>{throw new Error('upstream unavailable');}}),/upstream unavailable/);
});
