import { buildStoredFileUrl } from "@/lib/server/storage/service";

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
