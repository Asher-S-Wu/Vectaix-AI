import crypto from 'node:crypto';
import undici from 'undici';
import { getMediaConnection } from '@/lib/server/media/settings';
import { isQwenClonedVoice, parseQwenSpeechInput, QWEN_AUDIO_MODEL, validateQwenBaseUrl } from '@/lib/media/shared/qwenAudio';

export class QwenAudioError extends Error {
  constructor(message, { status = 502, requestId = '', upstreamRejected = false } = {}) {
    super(message);
    this.name = 'QwenAudioError';
    Object.assign(this, { status, requestId, upstreamRejected });
  }
}

export function qwenErrorStatus(error) {
  if (error?.name === 'AbortError') return 499;
  return Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
}

export function qwenPublicMessage(error, defaultMessage) {
  if (error?.name === 'AbortError') return '操作已取消';
  return error instanceof QwenAudioError || qwenErrorStatus(error) < 500 ? error.message : defaultMessage;
}

export async function resolveQwenAudioConfig({ requireEnabled = true } = {}) {
  const config = await getMediaConnection('qwenAudio', { requireEnabled });
  const baseUrl = validateQwenBaseUrl(config.baseUrl);
  return { apiKey: config.apiKey, endpoint: `${baseUrl}/api/v1/services/audio/tts/customization`, websocketUrl: `${baseUrl.replace('https:', 'wss:')}/api-ws/v1/inference` };
}

async function customization(input, { signal, requireEnabled = true } = {}) {
  const config = await resolveQwenAudioConfig({ requireEnabled });
  const timeout = AbortSignal.timeout(60000);
  const response = await fetch(config.endpoint, {
    method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'voice-enrollment', input }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout, redirect: 'error', cache: 'no-store',
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new QwenAudioError('Qwen 音色服务请求失败，请检查密钥、权限和声音样本', { status: response.status === 401 || response.status === 403 ? 503 : response.status >= 500 ? 502 : response.status, upstreamRejected: response.status < 500 });
  }
  const data = await response.json();
  if (!data.output || data.code) throw new QwenAudioError('Qwen 音色服务返回异常', { requestId: data.request_id });
  return data.output;
}

function requireClonedVoice(voiceId) {
  if (!isQwenClonedVoice(voiceId)) throw new QwenAudioError('Qwen 复刻音色编号无效', { status: 400, upstreamRejected: true });
}

export async function createQwenVoice({ sample, signal }) {
  const mimeType = { wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4' }[sample.name.split('.').pop().toLowerCase()];
  if (!mimeType) throw new QwenAudioError('请上传 WAV、MP3 或 M4A 音频', { status: 400 });
  const output = await customization({ action: 'create_voice', target_model: QWEN_AUDIO_MODEL, prefix: 'vectaix', audio: `data:${mimeType};base64,${Buffer.from(await sample.arrayBuffer()).toString('base64')}` }, { signal });
  requireClonedVoice(output.voice_id);
  return { _id: output.voice_id, state: 'training', languages: [] };
}

export async function getQwenVoice(voiceId, { signal } = {}) {
  requireClonedVoice(voiceId);
  const output = await customization({ action: 'query_voice', voice_id: voiceId }, { signal });
  const state = { DEPLOYING: 'training', OK: 'trained', UNDEPLOYED: 'failed' }[output.status];
  if (!state || output.target_model !== QWEN_AUDIO_MODEL) throw new QwenAudioError('Qwen 音色状态或所属模型有误');
  return { _id: voiceId, state, languages: [] };
}

export async function deleteQwenVoice(voiceId, { signal } = {}) {
  requireClonedVoice(voiceId);
  await customization({ action: 'delete_voice', voice_id: voiceId }, { signal, requireEnabled: false });
}

export async function synthesizeQwenSpeech(body, { signal, onRequestDispatched, onUpstreamComplete } = {}) {
  const input = parseQwenSpeechInput(body);
  const config = await resolveQwenAudioConfig();
  const timeout = AbortSignal.timeout(240000);
  const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;
  abort.throwIfAborted();
  return new Promise((resolve, reject) => {
    let connection, settled = false;
    const connect = undici.buildConnector({ timeout: 60000 });
    const dispatcher = new undici.Agent({ connect(options, callback) {
      connect(options, (error, socket) => {
        connection = socket;
        if (settled && socket) socket.destroy();
        callback(error, socket);
      });
    } });
    const ws = new undici.WebSocket(config.websocketUrl, { headers: { Authorization: `Bearer ${config.apiKey}` }, dispatcher });
    ws.binaryType = 'arraybuffer';
    const taskId = crypto.randomUUID();
    const chunks = [];
    let size = 0, started = false;
    function finish(error, result) {
      if (settled) return;
      settled = true;
      abort.removeEventListener('abort', cancel);
      ws.close();
      connection?.destroy();
      dispatcher.destroy().then(() => { if (error) reject(error); else resolve(result); }, cleanupError => reject(error || cleanupError));
    }
    function cancel() { finish(abort.reason); }
    function send(action, payload) { ws.send(JSON.stringify({ header: { action, task_id: taskId, streaming: 'duplex' }, payload })); }
    abort.addEventListener('abort', cancel, { once: true });
    ws.addEventListener('open', () => {
      if (settled) return;
      try {
        onRequestDispatched?.();
        send('run-task', { task_group: 'audio', task: 'tts', function: 'SpeechSynthesizer', model: QWEN_AUDIO_MODEL,
          parameters: { text_type: 'PlainText', voice: input.voiceId, format: input.format, sample_rate: input.sampleRate, volume: input.volume, rate: input.speed, pitch: 1 }, input: {} });
      } catch (error) { finish(error); }
    });
    ws.addEventListener('message', event => {
      if (settled) return;
      try {
        if (typeof event.data !== 'string') {
          if (!started || !(event.data instanceof ArrayBuffer)) throw new QwenAudioError('Qwen 返回了异常音频数据');
          size += event.data.byteLength;
          if (size > 100 * 1024 * 1024) throw new QwenAudioError('Qwen 返回音频超过大小限制');
          chunks.push(Buffer.from(event.data));
          return;
        }
        const data = JSON.parse(event.data);
        if (data.header?.task_id !== taskId) throw new QwenAudioError('Qwen 返回的语音任务编号有误');
        const kind = data.header.event;
        if (kind === 'task-started') {
          if (started) throw new QwenAudioError('Qwen 重复启动语音任务');
          started = true;
          send('continue-task', { input: { text: input.text } });
          send('finish-task', { input: {} });
        } else if (kind === 'task-failed') {
          throw new QwenAudioError('Qwen 语音合成失败，请检查文字、音色和账户权限', { status: data.header.error_code === 'InvalidParameter' ? 400 : 502, requestId: taskId, upstreamRejected: size === 0 });
        } else if (kind === 'task-finished') {
          onUpstreamComplete?.();
          const characters = data.payload?.usage?.characters;
          if (!started || !size || !Number.isSafeInteger(characters) || characters < 1) throw new QwenAudioError('Qwen 返回的音频或计费用量不完整');
          finish(null, { audioBuffer: Buffer.concat(chunks, size), mimeType: input.format === 'wav' ? 'audio/wav' : 'audio/mpeg', bytes: Buffer.byteLength(input.text, 'utf8'), characters, requestId: data.header.attributes?.request_uuid || taskId });
        }
      } catch (error) { finish(error); }
    });
    ws.addEventListener('error', () => finish(new QwenAudioError('Qwen 语音连接失败，请检查新加坡节点密钥和账户权限')));
    ws.addEventListener('close', () => finish(new QwenAudioError('Qwen 语音连接提前结束，音频尚未生成完整')));
  });
}
