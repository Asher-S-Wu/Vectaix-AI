import { buildStoredFileUrl } from "@/lib/server/storage/service";

function normalizeObject(value) {
  if (!value || typeof value !== "object") return null;
  return typeof value.toObject === "function" ? value.toObject() : value;
}

export function serializeDoubaoAudioGeneration(generation, { includeSubtitle = false } = {}) {
  const item = normalizeObject(generation);
  if (!item) return null;
  const generationId = String(item.generationId || "");
  const audioFileId = item.audioFileId ? String(item.audioFileId) : "";
  return {
    id: generationId,
    generationId,
    model: item.model,
    mode: item.mode,
    textPrompt: item.textPrompt,
    referenceCount: item.referenceCount,
    format: item.format,
    speechRate: item.speechRate,
    subtitleEnabled: Boolean(item.subtitleEnabled),
    hasSubtitle: Boolean(item.hasSubtitle),
    duration: item.duration,
    audioFileId,
    audioUrl: audioFileId ? buildStoredFileUrl(audioFileId) : "",
    ...(includeSubtitle ? { subtitle: item.subtitle || null } : {}),
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
  };
}
