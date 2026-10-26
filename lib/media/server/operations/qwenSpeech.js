import { QWEN_AUDIO_MODEL, QWEN_BUILTIN_VOICES, parseQwenSpeechInput } from '@/lib/media/shared/qwenAudio';
import { QwenAudioError, getQwenVoice, qwenErrorStatus, qwenPublicMessage, synthesizeQwenSpeech } from '@/lib/media/server/qwenAudio';
import { serializeAudioGeneration } from '@/lib/media/server/audioRecords';
import { calculateQwenTtsCost } from '@/lib/server/credits/pricing';
import { getAgentMediaSettings } from '@/lib/server/media/settings';
import QwenVoice from '@/models/QwenVoice';
import QwenAudioGeneration from '@/models/QwenAudioGeneration';
import { runSpeech } from './speech';

export async function resolveQwenVoice({ userId, voiceId, signal }) {
  const builtin = QWEN_BUILTIN_VOICES.find(voice => voice.voiceId === voiceId);
  if (builtin) return { voiceId, voiceName: builtin.displayName, languages: builtin.languages };
  const shared = (await getAgentMediaSettings()).audio;
  const isShared = shared?.provider === 'qwen' && shared.voiceId === voiceId;
  const record = await QwenVoice.findOne({ voiceId, ...(isShared ? {} : { userId }) }).lean();
  if (!record) throw new QwenAudioError('请选择管理员启用的 Qwen 音色', { status: 404 });
  const voice = await getQwenVoice(voiceId, { signal });
  if (voice.state !== 'trained') throw new QwenAudioError('该音色尚未就绪，请刷新音色状态或选择其他音色', { status: 409 });
  return { voiceId, voiceName: record.displayName, languages: voice.languages };
}

const service = { provider: 'qwen', model: QWEN_AUDIO_MODEL, parseInput: parseQwenSpeechInput, resolveVoice: resolveQwenVoice, synthesize: synthesizeQwenSpeech, Generation: QwenAudioGeneration, serializeGeneration: serializeAudioGeneration, calculateCost: calculateQwenTtsCost, publicMessage: qwenPublicMessage, errorStatus: qwenErrorStatus };

export function generateQwenSpeech(options) { return runSpeech({ ...options, preview: false }, service); }
export function previewQwenSpeech(options) { return runSpeech({ ...options, preview: true }, service); }
