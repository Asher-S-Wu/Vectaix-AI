import { MINIMAX_AUDIO_MODEL, minimaxCloneStatus, parseMiniMaxSpeechInput } from "@/lib/media/shared/minimaxAudio";
import { MiniMaxAudioError, listMiniMaxVoices, minimaxErrorStatus, minimaxPublicMessage, minimaxVoiceLanguages, synthesizeMiniMaxSpeech } from "@/lib/media/server/minimaxAudio";
import { serializeMiniMaxAudioGeneration } from "@/lib/media/server/audioRecords";
import { calculateMiniMaxTtsCost } from "@/lib/server/credits/pricing";
import MiniMaxAudioGeneration from "@/models/MiniMaxAudioGeneration";
import MiniMaxVoice from "@/models/MiniMaxVoice";
import { getSharedAudioVoice } from "@/lib/server/media/settings";
import { runSpeech } from "./speech";

const privateVoice = () => new MiniMaxAudioError('请选择自己的音色或管理员共享音色', { status: 404 });

export async function resolveMiniMaxVoice({ userId, voiceId, signal }) {
  const isSharedVoice = await getSharedAudioVoice('minimax') === voiceId;
  const record = await MiniMaxVoice.findOne({ voiceId }).lean();
  if (record) {
    if (String(record.userId) !== String(userId) && !isSharedVoice) throw privateVoice();
    if (minimaxCloneStatus(record) === 'expired') throw new MiniMaxAudioError('该复刻音色超过 7 天未使用，已被 MiniMax 自动删除，请删除后重新复刻', { status: 409 });
    return { voiceId, voiceName: record.displayName, languages: record.languages };
  }
  const system = (await listMiniMaxVoices('system', { signal })).find(voice => voice.voice_id === voiceId);
  if (!system && !isSharedVoice) throw privateVoice();
  return { voiceId, voiceName: system?.voice_name || voiceId, languages: minimaxVoiceLanguages(voiceId) };
}

async function synthesize(input, options) {
  const result = await synthesizeMiniMaxSpeech(input, options);
  await MiniMaxVoice.updateOne({ voiceId: input.voiceId, activatedAt: null }, { $set: { activatedAt: new Date() } });
  return result;
}

const service = { provider: 'minimax', model: MINIMAX_AUDIO_MODEL, parseInput: parseMiniMaxSpeechInput, resolveVoice: resolveMiniMaxVoice, synthesize, Generation: MiniMaxAudioGeneration, serializeGeneration: serializeMiniMaxAudioGeneration, calculateCost: calculateMiniMaxTtsCost, publicMessage: minimaxPublicMessage, errorStatus: minimaxErrorStatus };

export function generateMiniMaxSpeech(options) { return runSpeech({ ...options, preview: false }, service); }
export function previewMiniMaxSpeech(options) { return runSpeech({ ...options, preview: true }, service); }
