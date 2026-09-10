import path from 'node:path';
import { writeFile, rename, rm } from 'node:fs/promises';
import crypto from 'node:crypto';
import StoredFile from '@/models/StoredFile';
import FileFolder from '@/models/FileFolder';
import WorkspaceProject from '@/models/WorkspaceProject';
import Conversation from '@/models/Conversation';
import WorkbenchTask from '@/models/WorkbenchTask';
import UserSettings from '@/models/UserSettings';
import WorkbenchMemory from '@/models/WorkbenchMemory';
import WorkbenchSkill from '@/models/WorkbenchSkill';
import { inspectUploadedFile } from '@/lib/server/storage/fileInspection';
import { indexStoredDocument } from '@/lib/server/workbench/documents';
import { createStoredFile, findOwnedStoredFile, getStoredFileAbsolutePath, serializeStoredFile, readStoredFileBuffer, deleteStoredFileDocument } from '@/lib/server/storage/service';
import { requireObjectId, textField, workbenchError } from '@/lib/server/workbench/apiHelpers';
import { zipStream } from '@/lib/server/skills/archive.mjs';

const INDEXED_EXTENSIONS = new Set(['pdf','docx','xlsx','csv','txt','md']);
export const textFile = file => /^(text\/|application\/(json|xml|javascript))/.test(file.mimeType) || /\.(md|txt|csv|json|yaml|yml|xml|css|js|ts|html|py|sh)$/i.test(file.originalName);
export async function requireFolder(userId, id) { if (!id) return null; requireObjectId(id); const folder = await FileFolder.findOne({ _id: id, userId }); if (!folder) throw workbenchError('文件夹不存在', 404); return folder; }
export async function requireFile(userId, id) { const file = await findOwnedStoredFile({ userId, fileId: id }); if (!file) throw workbenchError('文件不存在', 404); return file; }
export function fileMetadata(file) { return { ...serializeStoredFile(file), folderId: file.folderId, ownerType: file.ownerType, ownerId: file.ownerId, editable: textFile(file), updatedAt: file.updatedAt }; }
export async function listLibrary(userId, folderId) { await requireFolder(userId, folderId); return { folders: await FileFolder.find({ userId }).sort({ name: 1 }).lean(), files: (await StoredFile.find({ userId, folderId: folderId || null }).sort({ originalName: 1 })).map(fileMetadata) }; }
export async function uploadLibrary(userId, uploads, folderId) {
  await requireFolder(userId, folderId);
  if (!uploads.length || uploads.length > 50 || uploads.reduce((n, f) => n+f.size, 0) > 100*1024*1024) throw workbenchError('一次最多上传 50 个文件，总大小不超过 100 MB');
  const files = [];
  for (const upload of uploads) {
    const ext = path.extname(upload.name).slice(1).toLowerCase() || 'bin', input = Buffer.from(await upload.arrayBuffer());
    const media = inspectUploadedFile(input, ext);
    if (/^(jpg|jpeg|png|gif|webp|bmp|tif|tiff|mp3|wav|m4a|aac|ogg|weba|mp4|mov|webm|m4v)$/.test(ext) && !media) throw workbenchError('文件内容与扩展名不匹配');
    const mime = media ? media.mimeType : upload.type || 'application/octet-stream';
    const file = await createStoredFile({ userId, input, originalName: upload.name, mimeType: mime, extension: ext, category: media ? media.category : 'document', kind: 'library', ownerType: 'library' });
    try { file.folderId = folderId || null; await file.save(); if (INDEXED_EXTENSIONS.has(file.extension)) await indexStoredDocument({ userId, file }); } catch (error) { await deleteStoredFileDocument(file); throw error; } files.push(fileMetadata(file));
  } return files;
}
export async function updateFile(userId, id, body) {
  const file = await requireFile(userId, id);
  if (body.name !== undefined) { const name = textField(body.name, '文件名称', 200, true); if (/[\\/\x00-\x1f]/.test(name)) throw workbenchError('文件名称不能包含路径'); file.originalName = name; }
  if (body.folderId !== undefined) { await requireFolder(userId, body.folderId); file.folderId = body.folderId || null; }
  if (body.content !== undefined) {
    if (!textFile(file) || typeof body.content !== 'string' || Buffer.byteLength(body.content) > 200000) throw workbenchError('只能编辑 200 KB 以内的文本文件');
    if (!body.content.length) throw workbenchError('文件内容不能为空');
    const target = getStoredFileAbsolutePath(file), temporary = `${target}.${crypto.randomUUID()}.tmp`, original = await readStoredFileBuffer(file);
    try { await writeFile(temporary, body.content, { mode: 0o600, flag: 'wx' }); await rename(temporary, target); if (INDEXED_EXTENSIONS.has(file.extension)) await indexStoredDocument({ userId, file, projectId: file.ownerType === 'project' ? file.ownerId : null, conversationId: file.ownerType === 'conversation' ? file.ownerId : null }); } catch (error) { await writeFile(target, original, { mode: 0o600 }); throw error; } finally { await rm(temporary, { force: true }); }
    file.size = Buffer.byteLength(body.content);
  }
  await file.save(); return fileMetadata(file);
}
export async function readText(userId, id) { const file = await requireFile(userId, id); if (!textFile(file) || file.size > 200000) throw workbenchError('只能读取 200 KB 以内的文本文件'); return (await readStoredFileBuffer(file)).toString('utf8'); }
export async function updateFolder(userId, id, body) {
  const folder = await requireFolder(userId, id);
  if (body.name !== undefined) folder.name = textField(body.name, '文件夹名称', 200, true);
  if (body.parentId !== undefined) { let parent = await requireFolder(userId, body.parentId); while (parent) { if (String(parent._id) === id) throw workbenchError('不能移动到自己或子文件夹中'); parent = await requireFolder(userId, parent.parentId ? String(parent.parentId) : null); } folder.parentId = body.parentId || null; }
  await folder.save(); return folder;
}
export async function deleteFolder(userId, id) {
  await requireFolder(userId, id);
  const all = await FileFolder.find({ userId }).lean(), ids = [id];
  for (let index = 0; index < ids.length; index++) for (const folder of all) if (String(folder.parentId) === ids[index]) ids.push(String(folder._id));
  const files = await StoredFile.find({ userId, folderId: { $in: ids } }); await assertFilesDeletable(userId, files);
  for (const file of files) await deleteStoredFileDocument(file);
  await FileFolder.deleteMany({ userId, _id: { $in: ids } });
}

export async function downloadFiles(userId, ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 100) throw workbenchError('请选择 1 到 100 个文件');
  const files = await Promise.all([...new Set(ids)].map(id => requireFile(userId, id)));
  return zipStream(files.map((file, index) => ({ name: `${index+1}-${file.originalName.replace(/[\\/\x00-\x1f:]/g, '_')}`, path: getStoredFileAbsolutePath(file) })));
}
export async function copyToProject(userId, fileId, projectId) {
  requireObjectId(projectId); if (!await WorkspaceProject.exists({ _id: projectId, userId })) throw workbenchError('项目不存在', 404);
  const file = await requireFile(userId, fileId);
  const copied = await createStoredFile({ userId, input: await readStoredFileBuffer(file), originalName: file.originalName, mimeType: file.mimeType, extension: file.extension, category: file.category, kind: INDEXED_EXTENSIONS.has(file.extension) ? 'project-document' : 'project-media', ownerType: 'project', ownerId: projectId });
  try { if (INDEXED_EXTENSIONS.has(file.extension)) await indexStoredDocument({ userId, file: copied, projectId }); } catch (error) { await deleteStoredFileDocument(copied); throw error; }
  return copied;
}

function collectReferences(value, target) {
  if (typeof value === 'string') { for (const match of value.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi)) target.add(match[0].toLowerCase()); }
  else if (Array.isArray(value)) for (const item of value) collectReferences(item, target);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) collectReferences(item, target);
}
export async function referencedFileIds(userId) {
  const [conversations, tasks, settings, memories, skills] = await Promise.all([Conversation.find({ userId }).select('messages').lean(), WorkbenchTask.find({ userId }).select('artifacts output mediaTasks').lean(), UserSettings.findOne({ userId }).select('avatarFileId assistant').lean(), WorkbenchMemory.find({ userId }).select('content').lean(), WorkbenchSkill.find({ userId }).select('content').lean()]);
  const ids = new Set(); for (const value of [...conversations, ...tasks, settings, ...memories, ...skills]) collectReferences(JSON.parse(JSON.stringify(value)), ids); return ids;
}
export async function assertFilesDeletable(userId, files) {
  if (files.some(file => !['library','temporary','project','conversation','task'].includes(file.ownerType) || file.kind === 'audio-source')) throw workbenchError('该文件由其他功能管理，请在对应页面删除', 409);
  const refs = await referencedFileIds(userId);
  if (files.some(file => String(file.userId) !== String(userId) || refs.has(file.fileId))) throw workbenchError('文件仍被对话、任务或头像使用，请先移除对应引用', 409);
  const tasks = await WorkbenchTask.find({ userId, status: { $in: ['queued','running','waiting_media','waiting_approval'] } }).select('_id projectId conversationId').lean();
  if (files.some(file => tasks.some(task => file.ownerType === 'library' || (file.ownerType === 'project' && String(task.projectId) === file.ownerId) || (file.ownerType === 'conversation' && String(task.conversationId) === file.ownerId) || (file.ownerType === 'task' && String(task._id) === file.ownerId)))) throw workbenchError('文件所属任务正在运行，请结束后再删除', 409);
}
export async function deleteLibraryFile(userId, id) { const file = await requireFile(userId, id); await assertFilesDeletable(userId, [file]); await deleteStoredFileDocument(file); }
