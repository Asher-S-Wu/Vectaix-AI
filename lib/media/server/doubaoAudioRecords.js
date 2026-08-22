import { buildStoredFileUrl } from "@/lib/server/storage/service";

function plain(value) {
  return typeof value?.toObject === "function" ? value.toObject() : value;
}

export function serializeDoubaoVoice(voice) {
  const item = plain(voice);
  if (!item) return null;
  return {
    id: item.profileId,
    profileId: item.profileId,
    voiceId: item.profileId,
    displayName: item.displayName,
    model: item.model,
    status: item.status,
    sampleFileName: item.sampleFileName,
    duration: Number(item.duration),
    sampleRate: Number(item.sampleRate),
    size: Number(item.size),
    audioUrl: buildStoredFileUrl(item.sampleFileId),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function serializeDoubaoAudioGeneration(generation) {
  const item = plain(generation);
  if (!item) return null;
  return {
    id: item.generationId,
    generationId: item.generationId,
    model: item.model,
    text: item.text,
    voiceId: item.voiceId,
    profileId: item.profileId,
    voiceName: item.voiceName,
    instruction: item.instruction || "",
    format: item.format,
    sampleRate: Number(item.sampleRate),
    speechRate: Number(item.speechRate),
    loudnessRate: Number(item.loudnessRate),
    pitchRate: Number(item.pitchRate),
    duration: Number(item.duration),
    originalDuration: Number(item.originalDuration),
    requestId: item.requestId,
    upstreamLogId: item.upstreamLogId,
    audioUrl: buildStoredFileUrl(item.audioFileId),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}
