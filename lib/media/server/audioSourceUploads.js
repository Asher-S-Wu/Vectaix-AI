import crypto from "node:crypto";
import {
  AUDIO_UPLOAD_EXPIRY_MS,
  AUDIO_UPLOAD_MAX_BYTES,
  AUDIO_UPLOAD_MAX_DURATION_SECONDS,
  AUDIO_UPLOAD_PURPOSE_IDS,
  AUDIO_UPLOAD_PURPOSES,
  getAudioClipLimits,
  isAudioUploadExtensionAllowed,
} from "@/lib/media/shared/audioUploads";
import { probeAudioSource } from "@/lib/media/server/audioTranscoding";
import {
  createStoredFileFromWebStream,
  deleteStoredFileDocument,
  getStoredFileAbsolutePath,
  normalizeFileId,
} from "@/lib/server/storage/service";
import { assertMediaWriteLeaseActive } from "@/lib/media/server/userOperationLeases";
import StoredFile from "@/models/StoredFile";

const MIME_BY_EXTENSION = Object.freeze({
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  ogg: "audio/ogg",
  opus: "audio/opus",
  webm: "audio/webm",
});

function audioSourceError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function sanitizeOriginalName(name, extension) {
  const fallback = `audio-source.${extension}`;
  const value = String(name || fallback).trim();
  if (!value) return fallback;
  const suffix = `.${extension}`;
  return value.length <= 200
    ? value
    : `${value.slice(0, 200 - suffix.length)}${suffix}`;
}

export function isAudioUploadPurpose(value) {
  return AUDIO_UPLOAD_PURPOSE_IDS.includes(String(value || ""));
}

export function getAudioUploadMimeType(extension) {
  return MIME_BY_EXTENSION[String(extension || "").toLowerCase()] || "";
}

export function serializeAudioSource(file) {
  const limits = getAudioClipLimits(file.audioPurpose);
  return {
    fileId: file.fileId,
    name: file.originalName,
    size: Number(file.size) || 0,
    duration: Number(file.audioDuration) || 0,
    channels: Number(file.audioChannels) || 0,
    sampleRate: Number(file.audioSampleRate) || 0,
    minClipSeconds: limits?.minSeconds || 0,
    maxClipSeconds: limits?.maxSeconds || 0,
  };
}

export async function createAudioSourceUpload({
  userId,
  input,
  originalName,
  extension,
  purpose,
  signal,
  mediaWriteLease,
}) {
  const mimeType = getAudioUploadMimeType(extension);
  if (
    !mimeType
    || !isAudioUploadPurpose(purpose)
    || !isAudioUploadExtensionAllowed(purpose, extension)
  ) {
    throw audioSourceError("音频上传参数无效");
  }

  const stored = await createStoredFileFromWebStream({
    userId,
    input,
    originalName: sanitizeOriginalName(originalName, extension),
    mimeType,
    extension,
    category: "audio",
    kind: "audio-source",
    ownerType: "temporary",
    ownerId: null,
    maxBytes: AUDIO_UPLOAD_MAX_BYTES,
    signal,
    mediaWriteLease,
  });

  try {
    const metadata = await probeAudioSource({
      inputPath: getStoredFileAbsolutePath(stored),
      extension,
      signal,
    });
    if (metadata.duration > AUDIO_UPLOAD_MAX_DURATION_SECONDS) {
      throw audioSourceError("原音频最长不能超过 30 分钟", 413);
    }
    const limits = getAudioClipLimits(purpose);
    if (metadata.duration < limits.minSeconds) {
      throw audioSourceError(`音频至少需要 ${limits.minSeconds} 秒`);
    }

    await assertMediaWriteLeaseActive(mediaWriteLease);
    stored.audioPurpose = purpose;
    stored.audioDuration = metadata.duration;
    stored.audioChannels = metadata.channels;
    stored.audioSampleRate = metadata.sampleRate;
    await stored.save();
    return stored;
  } catch (error) {
    await deleteStoredFileDocument(stored).catch(() => {});
    throw error;
  }
}

export async function claimAudioSources({ userId, fileIds, purpose, operationId }) {
  const normalizedIds = Array.from(new Set(
    (Array.isArray(fileIds) ? fileIds : []).map(normalizeFileId).filter(Boolean),
  ));
  if (
    normalizedIds.length !== (Array.isArray(fileIds) ? fileIds.length : 0)
    || !isAudioUploadPurpose(purpose)
    || !operationId
  ) {
    throw audioSourceError("临时音频参数无效");
  }

  const claimed = await StoredFile.updateMany(
    {
      userId,
      fileId: { $in: normalizedIds },
      kind: "audio-source",
      audioPurpose: purpose,
      ownerType: "temporary",
      ownerId: null,
      createdAt: { $gte: new Date(Date.now() - AUDIO_UPLOAD_EXPIRY_MS) },
    },
    {
      $set: {
        ownerType: "audio-processing",
        ownerId: operationId,
      },
    },
  );
  if (claimed.modifiedCount !== normalizedIds.length) {
    await StoredFile.updateMany(
      {
        userId,
        kind: "audio-source",
        ownerType: "audio-processing",
        ownerId: operationId,
      },
      { $set: { ownerType: "temporary", ownerId: null } },
    );
    throw audioSourceError("临时音频不存在、已过期或正在使用", 409);
  }

  const files = await StoredFile.find({
    userId,
    fileId: { $in: normalizedIds },
    kind: "audio-source",
    audioPurpose: purpose,
    ownerType: "audio-processing",
    ownerId: operationId,
  });
  const byId = new Map(files.map((file) => [file.fileId, file]));
  const ordered = normalizedIds.map((fileId) => byId.get(fileId)).filter(Boolean);
  if (ordered.length !== normalizedIds.length) {
    await deleteClaimedAudioSources({ userId, operationId });
    throw audioSourceError("读取临时音频失败", 500);
  }
  return ordered;
}

export async function deleteClaimedAudioSources({ userId, operationId }) {
  if (!userId || !operationId) return 0;
  const files = await StoredFile.find({
    userId,
    kind: "audio-source",
    ownerType: "audio-processing",
    ownerId: operationId,
  });
  const results = await Promise.allSettled(
    files.map((file) => deleteStoredFileDocument(file)),
  );
  const failed = results.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;
  return files.length;
}

export async function deleteOwnedTemporaryAudioSource({ userId, fileId }) {
  const normalized = normalizeFileId(fileId);
  if (!normalized) return false;
  const file = await StoredFile.findOneAndUpdate(
    {
      userId,
      fileId: normalized,
      kind: "audio-source",
      ownerType: "temporary",
      ownerId: null,
    },
    {
      $set: {
        ownerType: "audio-processing",
        ownerId: `delete:${crypto.randomUUID()}`,
      },
    },
    { new: true },
  );
  if (!file) return false;
  await deleteStoredFileDocument(file);
  return true;
}

export async function cleanupExpiredAudioSourceUploads(now = new Date()) {
  const cutoff = new Date(now.getTime() - AUDIO_UPLOAD_EXPIRY_MS);
  const candidates = await StoredFile.find({
    kind: "audio-source",
    $or: [
      { ownerType: "temporary", createdAt: { $lt: cutoff } },
      { ownerType: "audio-processing", updatedAt: { $lt: cutoff } },
    ],
  }).select("_id");
  let deleted = 0;
  for (const candidate of candidates) {
    const cleanupId = `cleanup:${crypto.randomUUID()}`;
    const file = await StoredFile.findOneAndUpdate(
      {
        _id: candidate._id,
        kind: "audio-source",
        $or: [
          { ownerType: "temporary", createdAt: { $lt: cutoff } },
          { ownerType: "audio-processing", updatedAt: { $lt: cutoff } },
        ],
      },
      { $set: { ownerType: "audio-processing", ownerId: cleanupId } },
      { new: true },
    );
    if (!file) continue;
    await deleteStoredFileDocument(file);
    deleted += 1;
  }
  return deleted;
}

export function getAudioSourceAbsolutePath(file) {
  if (!file || file.kind !== "audio-source") {
    throw audioSourceError("临时音频不存在", 404);
  }
  return getStoredFileAbsolutePath(file);
}

export function getAudioSourcePurposeLabel(purpose) {
  if (purpose === AUDIO_UPLOAD_PURPOSES.DOUBAO_VOICE_LIBRARY) {
    return "参考声音";
  }
  return purpose === AUDIO_UPLOAD_PURPOSES.VOICE_CLONE
    || purpose === AUDIO_UPLOAD_PURPOSES.MINIMAX_VOICE_CLONE
    ? "声音样本"
    : "参考音频";
}
