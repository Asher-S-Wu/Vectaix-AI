import crypto from "node:crypto";
import path from "node:path";
import {
  access,
  lstat,
  mkdir,
  opendir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  constants as fsConstants,
  createReadStream,
  createWriteStream,
} from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import StoredFile from "@/models/StoredFile";
import { getStorageFilesRoot, getStorageRoot } from "@/lib/server/storage/config";
import { normalizeFileId } from "@/lib/shared/fileIds";
import { assertMediaWriteLeaseActive } from "@/lib/media/server/userOperationLeases";

const TEMP_FILE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const STORAGE_ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const USER_DIRECTORY_PATTERN = /^[0-9a-f]{24}$/i;
const UUID_V4_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const FINAL_STORAGE_FILE_PATTERN = new RegExp(`^(${UUID_V4_SOURCE})$`, "i");
const TEMP_STORAGE_FILE_PATTERN = new RegExp(
  `^(${UUID_V4_SOURCE})\\.(${UUID_V4_SOURCE})\\.tmp$`,
  "i",
);
const ORPHAN_DB_BATCH_SIZE = 500;

export { normalizeFileId };

export function buildStoredFileUrl(fileId) {
  const normalized = normalizeFileId(fileId);
  return normalized ? `/api/files/${normalized}` : "";
}

function safeUserSegment(userId) {
  const value = String(userId || "").trim();
  if (!/^[0-9a-f]{24}$/i.test(value)) {
    throw new Error("无效的用户文件目录");
  }
  return value.toLowerCase();
}

function resolveStorageKey(storageKey) {
  const filesRoot = getStorageFilesRoot();
  const resolved = path.resolve(filesRoot, String(storageKey || ""));
  const relative = path.relative(filesRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("非法的存储路径");
  }
  return resolved;
}

export async function ensureStorageReady() {
  const root = getStorageRoot();
  const filesRoot = getStorageFilesRoot();
  await mkdir(filesRoot, { recursive: true });
  await access(root, fsConstants.R_OK | fsConstants.W_OK);
  await access(filesRoot, fsConstants.R_OK | fsConstants.W_OK);
  return { root, filesRoot };
}

function normalizeBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof ArrayBuffer) return Buffer.from(new Uint8Array(input));
  if (input instanceof Uint8Array) return Buffer.from(input);
  throw new Error("无效的文件内容");
}

export function serializeStoredFile(file) {
  const item = typeof file?.toObject === "function" ? file.toObject() : file;
  if (!item?.fileId) return null;
  return {
    fileId: item.fileId,
    url: buildStoredFileUrl(item.fileId),
    name: item.originalName,
    mimeType: item.mimeType,
    size: Number(item.size) || 0,
    extension: item.extension,
    category: item.category,
    ...(Number.isFinite(item.videoDuration) ? { videoDuration: item.videoDuration } : {}),
  };
}

export function collectStoredFileIds(messages) {
  const ids = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    for (const part of Array.isArray(message?.parts) ? message.parts : []) {
      const imageId = normalizeFileId(part?.inlineData?.fileId);
      const mediaId = normalizeFileId(part?.fileData?.fileId);
      if (imageId) ids.push(imageId);
      if (mediaId) ids.push(mediaId);
    }
  }
  return Array.from(new Set(ids));
}

export async function createStoredFile({
  userId,
  input,
  originalName,
  mimeType,
  extension,
  category,
  kind,
  ownerType = "temporary",
  ownerId = null,
  mediaWriteLease = null,
}) {
  const buffer = normalizeBuffer(input);
  if (buffer.length === 0) throw new Error("文件内容为空");

  await ensureStorageReady();
  const fileId = crypto.randomUUID();
  const userSegment = safeUserSegment(userId);
  const storageKey = `${userSegment}/${fileId}`;
  const userDir = path.join(getStorageFilesRoot(), userSegment);
  const finalPath = resolveStorageKey(storageKey);
  const temporaryPath = `${finalPath}.${crypto.randomUUID()}.tmp`;
  await mkdir(userDir, { recursive: true });

  try {
    await writeFile(temporaryPath, buffer, { flag: "wx", mode: 0o600 });
    if (mediaWriteLease) {
      await assertMediaWriteLeaseActive(mediaWriteLease);
    }
    await rename(temporaryPath, finalPath);
    return await StoredFile.create({
      fileId,
      userId,
      storageKey,
      originalName: String(originalName || fileId).slice(0, 200),
      mimeType,
      size: buffer.length,
      extension,
      category,
      kind,
      ownerType,
      ownerId: ownerId ? String(ownerId) : null,
    });
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    await rm(finalPath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function createStoredFileFromWebStream({
  userId,
  input,
  originalName,
  mimeType,
  extension,
  category,
  kind,
  ownerType = "temporary",
  ownerId = null,
  maxBytes = null,
  signal,
  mediaWriteLease = null,
  validateTemporaryFileBeforeCommit = null,
  assertWriteCommitAllowed = null,
}) {
  if (!input || typeof input.getReader !== "function") {
    throw new Error("无效的流式文件内容");
  }

  await ensureStorageReady();
  const fileId = crypto.randomUUID();
  const userSegment = safeUserSegment(userId);
  const storageKey = `${userSegment}/${fileId}`;
  const userDir = path.join(getStorageFilesRoot(), userSegment);
  const finalPath = resolveStorageKey(storageKey);
  const temporaryPath = `${finalPath}.${crypto.randomUUID()}.tmp`;
  await mkdir(userDir, { recursive: true });
  let storedFile = null;
  let storedFileCreateAttempted = false;

  const assertCommitAllowed = async () => {
    if (signal?.aborted) {
      throw signal.reason || Object.assign(new Error("文件写入已中止"), {
        name: "AbortError",
      });
    }
    if (mediaWriteLease) await assertMediaWriteLeaseActive(mediaWriteLease);
    if (signal?.aborted) {
      throw signal.reason || Object.assign(new Error("文件写入已中止"), {
        name: "AbortError",
      });
    }
    if (assertWriteCommitAllowed) {
      if (typeof assertWriteCommitAllowed !== "function") {
        throw new TypeError("文件提交守卫无效");
      }
      await assertWriteCommitAllowed();
    }
    if (signal?.aborted) {
      throw signal.reason || Object.assign(new Error("文件写入已中止"), {
        name: "AbortError",
      });
    }
  };

  try {
    const source = Readable.fromWeb(input);
    const destination = createWriteStream(temporaryPath, {
      flags: "wx",
      mode: 0o600,
    });
    const normalizedMaxBytes = Number.isFinite(maxBytes) && maxBytes > 0
      ? Math.floor(maxBytes)
      : null;
    let receivedBytes = 0;
    const limiter = normalizedMaxBytes
      ? new Transform({
          transform(chunk, _encoding, callback) {
            receivedBytes += chunk.length;
            if (receivedBytes > normalizedMaxBytes) {
              const error = new Error("文件大小超过允许上限");
              error.status = 413;
              callback(error);
              return;
            }
            callback(null, chunk);
          },
        })
      : null;
    const streams = limiter ? [source, limiter, destination] : [source, destination];
    if (signal) {
      await pipeline(...streams, { signal });
    } else {
      await pipeline(...streams);
    }
    await assertCommitAllowed();

    const fileStats = await stat(temporaryPath);
    if (!fileStats.isFile() || fileStats.size === 0) {
      throw new Error("文件内容为空");
    }
    if (normalizedMaxBytes && fileStats.size > normalizedMaxBytes) {
      const error = new Error("文件大小超过允许上限");
      error.status = 413;
      throw error;
    }

    if (validateTemporaryFileBeforeCommit) {
      if (typeof validateTemporaryFileBeforeCommit !== "function") {
        throw new TypeError("临时文件提交前验证器无效");
      }
      await assertCommitAllowed();
      await validateTemporaryFileBeforeCommit({
        absolutePath: temporaryPath,
        size: fileStats.size,
      });
      await assertCommitAllowed();
    }

    await assertCommitAllowed();
    await rename(temporaryPath, finalPath);
    await assertCommitAllowed();
    storedFileCreateAttempted = true;
    storedFile = await StoredFile.create({
      fileId,
      userId,
      storageKey,
      originalName: String(originalName || fileId).slice(0, 200),
      mimeType,
      size: fileStats.size,
      extension,
      category,
      kind,
      ownerType,
      ownerId: ownerId ? String(ownerId) : null,
    });
    await assertCommitAllowed();
    return storedFile;
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    await rm(finalPath, { force: true }).catch(() => {});
    if (storedFileCreateAttempted) {
      await StoredFile.deleteOne({
        fileId,
        storageKey,
        userId,
      }).catch(() => {});
    }
    throw error;
  }
}

export async function findOwnedStoredFile({ userId, fileId }) {
  const normalized = normalizeFileId(fileId);
  if (!normalized || !userId) return null;
  return StoredFile.findOne({ fileId: normalized, userId });
}

export function getStoredFileAbsolutePath(file) {
  if (!file?.storageKey) throw new Error("文件缺少存储路径");
  return resolveStorageKey(file.storageKey);
}

export async function readStoredFileBuffer(file) {
  return readFile(getStoredFileAbsolutePath(file));
}

export function createStoredFileReadStream(file, options) {
  return createReadStream(getStoredFileAbsolutePath(file), options);
}

export async function bindStoredFiles({ userId, fileIds, ownerType, ownerId }) {
  const normalizedIds = Array.from(new Set(
    (Array.isArray(fileIds) ? fileIds : []).map(normalizeFileId).filter(Boolean)
  ));
  if (normalizedIds.length === 0) return [];
  const files = await StoredFile.find({ fileId: { $in: normalizedIds }, userId });
  if (files.length !== normalizedIds.length) {
    throw new Error("附件不存在或无权访问");
  }
  if (files.some((file) => file.kind === "audio-source")) {
    throw new Error("临时音频只能用于对应的音频操作");
  }
  const allowed = files.every((file) => (
    file.ownerType === "temporary"
    || (file.ownerType === ownerType && file.ownerId === String(ownerId))
  ));
  if (!allowed) throw new Error("附件已被其他内容占用");
  await StoredFile.updateMany(
    { fileId: { $in: normalizedIds }, userId },
    { $set: { ownerType, ownerId: String(ownerId) } }
  );
  return files;
}

export async function deleteStoredFileDocument(file) {
  if (!file) return;
  await rm(getStoredFileAbsolutePath(file), { force: true });
  await StoredFile.deleteOne({ _id: file._id });
}

export async function deleteOwnedTemporaryFile({ userId, fileId }) {
  const file = await findOwnedStoredFile({ userId, fileId });
  if (!file || file.ownerType !== "temporary" || file.kind === "audio-source") return false;
  await deleteStoredFileDocument(file);
  return true;
}

export async function deleteStoredFilesByOwner({ userId, ownerType, ownerId }) {
  const files = await StoredFile.find({ userId, ownerType, ownerId: String(ownerId) });
  for (const file of files) {
    await deleteStoredFileDocument(file);
  }
  return files.length;
}

export async function deleteStoredFilesByIds({ userId, fileIds, ownerType, ownerId }) {
  const normalizedIds = Array.from(new Set(
    (Array.isArray(fileIds) ? fileIds : []).map(normalizeFileId).filter(Boolean)
  ));
  if (normalizedIds.length === 0) return 0;
  const files = await StoredFile.find({
    userId,
    fileId: { $in: normalizedIds },
    ownerType,
    ownerId: String(ownerId),
  });
  for (const file of files) await deleteStoredFileDocument(file);
  return files.length;
}

export async function deleteAllStoredFilesForUser(userId) {
  const files = await StoredFile.find({ userId });
  for (const file of files) {
    await deleteStoredFileDocument(file);
  }
  const userDir = path.join(getStorageFilesRoot(), safeUserSegment(userId));
  await rm(userDir, { recursive: true, force: true });
  return files.length;
}

export async function cleanupExpiredTemporaryFiles(now = new Date()) {
  const cutoff = new Date(now.getTime() - TEMP_FILE_MAX_AGE_MS);
  const files = await StoredFile.find({
    ownerType: "temporary",
    kind: { $ne: "audio-source" },
    createdAt: { $lt: cutoff },
  });
  for (const file of files) {
    await deleteStoredFileDocument(file);
  }
  return files.length;
}

function safeStorageCleanupError(fileId, error) {
  const errorType = /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error?.name || "")
    ? error.name
    : "Error";
  const code = /^[A-Z][A-Z0-9_]{0,63}$/.test(error?.code || "")
    ? error.code
    : "STORAGE_CLEANUP_FAILED";
  console.error("[Storage] orphan cleanup file failed", {
    fileId: normalizeFileId(fileId) || "",
    errorType,
    code,
  });
}

export async function cleanupOrphanedStorageFiles(now = new Date()) {
  const cutoffMs = now.getTime() - STORAGE_ORPHAN_MAX_AGE_MS;
  if (!Number.isFinite(cutoffMs)) throw new TypeError("存储清理时间无效");
  const filesRoot = getStorageFilesRoot();
  const finalCandidates = [];
  let deletedCount = 0;

  const flushFinalCandidates = async () => {
    if (finalCandidates.length === 0) return;
    const batch = finalCandidates.slice();
    const storedFiles = await StoredFile.find({
      fileId: { $in: batch.map((item) => item.fileId) },
    }).select("fileId").lean();
    const existingFileIds = new Set(
      storedFiles.map((storedFile) => String(storedFile.fileId || "").toLowerCase()),
    );
    let batchDeletedCount = 0;
    for (const candidate of batch) {
      if (existingFileIds.has(candidate.fileId)) continue;
      try {
        await rm(candidate.absolutePath, { force: true });
        batchDeletedCount += 1;
      } catch (error) {
        safeStorageCleanupError(candidate.fileId, error);
      }
    }
    finalCandidates.length = 0;
    deletedCount += batchDeletedCount;
  };

  const rootDirectory = await opendir(filesRoot);
  for await (const userEntry of rootDirectory) {
    if (!userEntry.isDirectory() || !USER_DIRECTORY_PATTERN.test(userEntry.name)) continue;
    const userDirectory = resolveStorageKey(userEntry.name);
    let userDirectoryHandle;
    try {
      const directoryStats = await lstat(userDirectory);
      if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) continue;
      userDirectoryHandle = await opendir(userDirectory);
    } catch (error) {
      safeStorageCleanupError("", error);
      continue;
    }

    for await (const fileEntry of userDirectoryHandle) {
      if (!fileEntry.isFile()) continue;
      const temporaryMatch = TEMP_STORAGE_FILE_PATTERN.exec(fileEntry.name);
      const finalMatch = FINAL_STORAGE_FILE_PATTERN.exec(fileEntry.name);
      if (!temporaryMatch && !finalMatch) continue;
      const fileId = (temporaryMatch?.[1] || finalMatch?.[1] || "").toLowerCase();
      let shouldFlushFinalCandidates = false;
      try {
        const absolutePath = resolveStorageKey(`${userEntry.name}/${fileEntry.name}`);
        const fileStats = await lstat(absolutePath);
        if (
          !fileStats.isFile()
          || fileStats.isSymbolicLink()
          || fileStats.mtimeMs > cutoffMs
        ) {
          continue;
        }
        if (temporaryMatch) {
          await rm(absolutePath, { force: true });
          deletedCount += 1;
        } else {
          finalCandidates.push({ fileId, absolutePath });
          shouldFlushFinalCandidates = finalCandidates.length === ORPHAN_DB_BATCH_SIZE;
        }
      } catch (error) {
        safeStorageCleanupError(fileId, error);
      }
      if (shouldFlushFinalCandidates) await flushFinalCandidates();
    }
  }
  await flushFinalCandidates();
  return deletedCount;
}
