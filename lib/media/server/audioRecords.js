import { buildStoredFileUrl } from "@/lib/server/storage/service";

function normalizeObject(value) {
  if (!value || typeof value !== "object") return null;
  return typeof value.toObject === "function" ? value.toObject() : value;
}

export function serializeAudioGeneration(generation) {
  const item = normalizeObject(generation);
  if (!item) return null;
  const generationId = String(item.generationId || "");
  const audioFileId = item.audioFileId ? String(item.audioFileId) : "";
  return {
    id: generationId,
    generationId,
    model: item.model,
    text: item.text,
    voiceId: item.voiceId,
    voiceName: item.voiceName,
    instruction: item.instruction || "",
    format: item.format,
    sampleRate: item.sampleRate,
    rate: item.rate,
    pitch: item.pitch,
    volume: item.volume,
    languageHint: item.languageHint || "",
    characters: item.characters,
    requestId: item.requestId,
    audioFileId,
    audioUrl: audioFileId ? buildStoredFileUrl(audioFileId) : "",
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
  };
}

export function serializeCustomVoice(voice) {
  const item = normalizeObject(voice);
  if (!item) return null;
  const profileId = String(item.profileId || "");
  const reconciliationKind = item.remoteCreateUncertain && !item.voiceId
    ? "create"
    : item.remoteUpdateUncertain
      ? "update"
      : "";
  return {
    id: profileId,
    profileId,
    displayName: item.displayName,
    voiceId: item.voiceId || "",
    status: item.status,
    requiresAttention: Boolean(reconciliationKind),
    reconciliationKind,
    model: item.model,
    languageHint: item.languageHint,
    enablePreprocess: Boolean(item.enablePreprocess),
    sampleFileId: item.sampleFileId || "",
    sampleFileName: item.sampleFileName || "",
    consentConfirmedAt: item.consentConfirmedAt || null,
    upstreamCreatedAt: item.upstreamCreatedAt || null,
    upstreamModifiedAt: item.upstreamModifiedAt || null,
    lastStatusCheckedAt: item.lastStatusCheckedAt || null,
    lastRequestId: item.lastRequestId || "",
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
  };
}
