import { FISH_AUDIO_MODEL, parseFishSpeechInput } from "@/lib/media/shared/fishAudio";
import { FishAudioError, fishErrorStatus, fishPublicMessage, getFishVoice, synthesizeFishSpeech } from "@/lib/media/server/fishAudio";
import { serializeAudioGeneration } from "@/lib/media/server/audioRecords";
import { calculateFishTtsCost } from "@/lib/server/credits/pricing";
import FishAudioGeneration from "@/models/FishAudioGeneration";
import FishVoice from "@/models/FishVoice";
import { getAgentMediaSettings } from "@/lib/server/media/settings";
import { runSpeech } from "./speech";

export async function resolveFishVoice({ userId, voiceId, signal }) {
  const record = await FishVoice.findOne({ userId, voiceId }).lean();
  const globalSettings = await getAgentMediaSettings();
  const isSharedVoice = globalSettings.audio?.provider === "fish" && globalSettings.audio.voiceId === voiceId;
  if (!record && !isSharedVoice) throw new FishAudioError("请选择管理员启用的音色", { status: 404 });
  const voice = await getFishVoice(voiceId, { signal });
  if (voice.state !== "trained" || voice.dmca_taken_down) {
    throw new FishAudioError("该音色尚未就绪，请刷新音色状态或选择其他音色", { status: 409 });
  }
  return {
    voiceId: voice._id,
    voiceName: record ? record.displayName : voice.title,
    languages: Array.isArray(voice.languages) ? voice.languages : [],
  };
}

const service = { provider: 'fish', model: FISH_AUDIO_MODEL, parseInput: parseFishSpeechInput, resolveVoice: resolveFishVoice, synthesize: synthesizeFishSpeech, Generation: FishAudioGeneration, serializeGeneration: serializeAudioGeneration, calculateCost: calculateFishTtsCost, publicMessage: fishPublicMessage, errorStatus: fishErrorStatus };

export function generateFishSpeech(options) { return runSpeech({ ...options, preview: false }, service); }
export function previewFishSpeech(options) { return runSpeech({ ...options, preview: true }, service); }
