import { buildStoredFileUrl } from "@/lib/server/storage/service";
import { MINIMAX_CLONE_ACTIVATION_MS, minimaxCloneStatus } from "@/lib/media/shared/minimaxAudio";

export function serializeAudioGeneration(record) {
  const item = typeof record.toObject === "function" ? record.toObject() : record;
  return {
    id: item.generationId,
    generationId: item.generationId,
    model: item.model,
    text: item.text,
    voiceId: item.voiceId,
    voiceName: item.voiceName,
    format: item.format,
    sampleRate: item.sampleRate,
    speed: item.speed,
    stability: item.stability,
    similarityBoost: item.similarityBoost,
    style: item.style,
    useSpeakerBoost: item.useSpeakerBoost,
    characters: item.characters,
    bytes: item.bytes,
    audioFileId: item.audioFileId,
    audioUrl: buildStoredFileUrl(item.audioFileId),
    createdAt: item.createdAt,
  };
}

export function serializeMiniMaxAudioGeneration(record) {
  const item = typeof record.toObject === "function" ? record.toObject() : record;
  return {
    id: item.generationId,
    generationId: item.generationId,
    model: item.model,
    text: item.text,
    voiceId: item.voiceId,
    voiceName: item.voiceName,
    format: item.format,
    sampleRate: item.sampleRate,
    bitrate: item.bitrate,
    speed: item.speed,
    volume: item.volume,
    pitch: item.pitch,
    emotion: item.emotion,
    languageBoost: item.languageBoost,
    soundEffect: item.soundEffect,
    textNormalization: item.textNormalization,
    characters: item.characters,
    bytes: item.bytes,
    audioFileId: item.audioFileId,
    audioUrl: buildStoredFileUrl(item.audioFileId),
    createdAt: item.createdAt,
  };
}

export function serializeMiniMaxVoice(record) {
  const item = typeof record.toObject === "function" ? record.toObject() : record;
  return {
    id: item.profileId,
    profileId: item.profileId,
    voiceId: item.voiceId,
    displayName: item.displayName,
    status: minimaxCloneStatus(item),
    expiresAt: item.activatedAt ? null : new Date(new Date(item.createdAt).getTime() + MINIMAX_CLONE_ACTIVATION_MS),
    languages: item.languages,
    sampleFileName: item.sampleFileName,
    createdAt: item.createdAt,
  };
}

export function serializeVoice(record) {
  const item = typeof record.toObject === "function" ? record.toObject() : record;
  return {
    id: item.profileId,
    profileId: item.profileId,
    voiceId: item.voiceId,
    displayName: item.displayName,
    status: item.status,
    languages: item.languages,
    sampleFileName: item.sampleFileName,
    createdAt: item.createdAt,
  };
}
