import { ELEVENLABS_AUDIO_MODEL, parseElevenLabsSpeechInput } from "@/lib/media/shared/elevenlabsAudio";
import { ElevenLabsAudioError, elevenlabsErrorStatus, elevenlabsPublicMessage, elevenlabsVoiceStatus, elevenlabsVoiceLanguages, getElevenLabsVoice, synthesizeElevenLabsSpeech } from "@/lib/media/server/elevenlabsAudio";
import { serializeAudioGeneration } from "@/lib/media/server/audioRecords";
import { calculateElevenLabsTtsCost } from "@/lib/server/credits/pricing";
import ElevenLabsAudioGeneration from "@/models/ElevenLabsAudioGeneration";
import ElevenLabsVoice from "@/models/ElevenLabsVoice";
import { getSharedAudioVoice } from "@/lib/server/media/settings";
import { runSpeech } from "./speech";

export async function resolveElevenLabsVoice({ userId, voiceId, signal }) {
  const record = await ElevenLabsVoice.findOne({ userId, voiceId }).lean();
  const isSharedVoice = await getSharedAudioVoice() === voiceId;
  if (!record && !isSharedVoice && await ElevenLabsVoice.exists({ voiceId })) throw new ElevenLabsAudioError('请选择自己的音色或管理员共享音色', { status: 404 });
  const voice = await getElevenLabsVoice(voiceId, { signal });
  if (!record && !isSharedVoice && voice.category !== 'premade') throw new ElevenLabsAudioError('请选择自己的音色或管理员共享音色', { status: 404 });
  if (elevenlabsVoiceStatus(voice) !== 'trained') {
    throw new ElevenLabsAudioError("该音色尚未就绪，请刷新音色状态或选择其他音色", { status: 409 });
  }
  return {
    voiceId: voice.voice_id,
    voiceName: record ? record.displayName : voice.name,
    languages: elevenlabsVoiceLanguages(voice),
  };
}

const service = { provider: 'elevenlabs', model: ELEVENLABS_AUDIO_MODEL, parseInput: parseElevenLabsSpeechInput, resolveVoice: resolveElevenLabsVoice, synthesize: synthesizeElevenLabsSpeech, Generation: ElevenLabsAudioGeneration, serializeGeneration: serializeAudioGeneration, calculateCost: calculateElevenLabsTtsCost, publicMessage: elevenlabsPublicMessage, errorStatus: elevenlabsErrorStatus };

export function generateElevenLabsSpeech(options) { return runSpeech({ ...options, preview: false }, service); }
export function previewElevenLabsSpeech(options) { return runSpeech({ ...options, preview: true }, service); }
