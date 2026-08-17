function plain(value) {
  return typeof value?.toObject === "function" ? value.toObject() : value;
}

function fileUrl(fileId) {
  return fileId ? `/api/files/${encodeURIComponent(fileId)}` : "";
}

export function serializeMinimaxAudioGeneration(generation) {
  const item = plain(generation);
  if (!item) return null;
  return {
    id: item.generationId,
    model: item.model,
    text: item.text,
    voiceId: item.voiceId,
    voiceName: item.voiceName,
    voiceKind: item.voiceKind,
    emotion: item.emotion || "",
    speed: Number(item.speed),
    volume: Number(item.volume),
    pitch: Number(item.pitch),
    languageBoost: item.languageBoost || "",
    format: item.format,
    sampleRate: Number(item.sampleRate),
    characters: Number(item.characters) || 0,
    durationMs: Number(item.durationMs) || 0,
    requestId: item.requestId,
    audioUrl: fileUrl(item.audioFileId),
    createdAt: item.createdAt,
  };
}

export function serializeMinimaxVoice(voice) {
  const item = plain(voice);
  if (!item) return null;
  return {
    id: item.profileId,
    voiceId: item.voiceId,
    displayName: item.displayName,
    kind: "custom",
    status: item.status,
    cloneModel: item.cloneModel,
    demoText: item.demoText,
    languageBoost: item.languageBoost || "",
    noiseReduction: Boolean(item.noiseReduction),
    volumeNormalization: Boolean(item.volumeNormalization),
    sampleFileName: item.sampleFileName || "",
    demoAudioUrl: fileUrl(item.demoFileId),
    createdAt: item.createdAt,
  };
}

