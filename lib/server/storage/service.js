import crypto from "node:crypto";
import path from "node:path";
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants, createReadStream } from "node:fs";
import StoredFile from "@/models/StoredFile";
import { getStorageFilesRoot, getStorageRoot } from "@/lib/server/storage/config";
import { normalizeFileId } from "@/lib/shared/fileIds";

const TEMP_FILE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

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
  if (!file || file.ownerType !== "temporary") return false;
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
  const files = await StoredFile.find({ ownerType: "temporary", createdAt: { $lt: cutoff } });
  for (const file of files) {
    await deleteStoredFileDocument(file);
  }
  return files.length;
}
