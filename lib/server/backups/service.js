import path from 'node:path';
import crypto from 'node:crypto';
import { mkdir, rm, readFile, stat, open } from 'node:fs/promises';
import mongoose from 'mongoose';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import BackupJob from '@/models/BackupJob';
import BackupSchedule from '@/models/BackupSchedule';
import Conversation from '@/models/Conversation';
import WorkspaceProject from '@/models/WorkspaceProject';
import WorkspaceDocument from '@/models/WorkspaceDocument';
import StoredFile from '@/models/StoredFile';
import WorkbenchSkill from '@/models/WorkbenchSkill';
import SkillAsset from '@/models/SkillAsset';
import FileFolder from '@/models/FileFolder';
import WorkbenchMemory from '@/models/WorkbenchMemory';
import UserSettings from '@/models/UserSettings';
import { inspectUploadedFile } from '@/lib/server/storage/fileInspection';
import { getStorageRoot } from '@/lib/server/storage/config';
import { getStoredFileAbsolutePath, createStoredFileFromWebStream, deleteStoredFileDocument } from '@/lib/server/storage/service';
import { workbenchError, requireObjectId } from '@/lib/server/workbench/apiHelpers';
import { encryptSecret, decryptSecret } from '@/lib/server/security/secrets.mjs';
import { uploadRemoteFile } from '@/lib/server/integrations/remotes';
import { zipStream, extractZipFile, assetPath } from '@/lib/server/skills/archive.mjs';
import { validatePreferences } from '@/lib/shared/preferences.mjs';
import { encryptBackup, decryptBackup, validatePassword } from './crypto.mjs';
import { selectSections, safeSettings, safeConversation, rewriteReferences, nextScheduleRun, validateManifest, validateDependencies } from './snapshot.mjs';

const root = () => path.join(getStorageRoot(), 'backups');
const jobPath = job => path.join(root(), String(job.userId), `${job._id}.vxb`);
const plain = value => JSON.parse(JSON.stringify(value));
const take = (item, keys) => Object.fromEntries(keys.filter(k => item[k] !== undefined).map(k => [k, item[k]]));
async function beginJob(userId, selection, type = 'backup', extra = {}) {
  await BackupJob.init();
  try { return await BackupJob.create({ userId, status: 'running', type, selection, ...extra }); }
  catch (error) { if (error.code === 11000) throw workbenchError('已有备份或恢复任务正在进行，请完成后再操作', 409); throw error; }
}
async function snapshot(userId, selection) {
  const includes = key => selection.includes(key);
  const [conversations, projects, files, skills, memories, settings, folders] = await Promise.all([
    includes('conversations') ? Conversation.find({ userId }).lean() : [],
    includes('projects') ? WorkspaceProject.find({ userId }).lean() : [],
    includes('files') ? StoredFile.find({ userId, ownerType: { $ne: 'temporary' } }).lean() : [],
    includes('skills') ? WorkbenchSkill.find({ userId }).lean() : [],
    includes('memories') ? WorkbenchMemory.find({ userId }).lean() : [],
    includes('settings') ? UserSettings.findOne({ userId }).lean() : null,
    includes('files') ? FileFolder.find({ userId }).lean() : [],
  ]);
  const assets = includes('skills') ? await SkillAsset.find({ userId, skillId: { $in: skills.map(s => s._id) } }).select('-data').lean() : [];
  const documents = includes('files') ? await WorkspaceDocument.find({ userId, fileId: { $in: files.map(f => f.fileId) } }).lean() : [];
  const manifest = plain({ format: 'vectaix-backup', version: 1, createdAt: new Date().toISOString(), selection,
    conversations: conversations.map(safeConversation),
    projects: projects.map(p => take(p, ['_id','name','description','instructions','memoryEnabled'])),
    files: files.map(f => take(f, ['_id','fileId','originalName','mimeType','size','extension','category','kind','ownerType','ownerId','folderId'])),
    folders: folders.map(f => take(f, ['_id','name','parentId'])),
    skills: skills.map(s => take(s, ['_id','name','description','content','enabled','metadata','source'])),
    assets: assets.map(a => take(a, ['_id','skillId','path','size','executable'])),
    memories: memories.map(m => take(m, ['_id','projectId','scope','content','source','conversationId','createdAt','updatedAt'])),
    documents: documents.map(d => take(d, ['_id','projectId','conversationId','fileId','tables','chunks'])),
    settings: settings ? safeSettings(settings, { includeFiles: includes('files') }) : null,
  });
  validateDependencies(manifest);
  if (files.reduce((sum, file) => sum+file.size, 0) + assets.reduce((sum, asset) => sum+asset.size, 0) + Buffer.byteLength(JSON.stringify(manifest)) > 512*1024*1024) throw workbenchError('备份内容总大小不能超过 512 MB');
  return { manifest, entries: [{ name: 'manifest.json', buffer: Buffer.from(JSON.stringify(manifest)) }, ...files.map(f => ({ name: `files/${f.fileId}`, path: getStoredFileAbsolutePath(f) })), ...assets.map(a => ({ name: `assets/${a._id}`, open: async () => { const asset = await SkillAsset.findOne({ userId, _id: a._id }).select('data size'); if (!asset || asset.size !== a.size) throw workbenchError('技能附件已更改，请重新备份'); return Readable.from(Buffer.from(asset.data)); } }))] };
}
export async function createBackup(userId, { selection, password, destination, scheduleId }) {
  selection = selectSections(selection); validatePassword(password);
  const job = await beginJob(userId, selection, 'backup', { destination, scheduleId });
  const destinationFile = jobPath(job);
  try {
    await mkdir(path.dirname(destinationFile), { recursive: true });
    const { manifest, entries } = await snapshot(userId, selection);
    await encryptBackup(zipStream(entries), destinationFile, password);
    if ((await stat(destinationFile)).size > 1024*1024*1024) throw workbenchError('备份超过 1 GB 限制');
    if (destination?.connectionId) {
      if (!destination.path?.trim()) throw workbenchError('请选择远端目标路径');
      await uploadRemoteFile({ userId, connectionId: destination.connectionId, localPath: destinationFile, destinationPath: `${destination.path.replace(/\/$/, '')}/vectaix-${job._id}.vxb`, maxBytes: 1024*1024*1024 });
    }
    job.status = 'completed'; job.filename = `vectaix-${job._id}.vxb`; job.completedAt = new Date(); job.counts = Object.fromEntries(selection.map(key => [key, key === 'settings' ? Number(Boolean(manifest.settings)) : manifest[key].length])); await job.save(); return job;
  } catch (error) { await rm(destinationFile, { force: true }); job.status = 'failed'; job.error = error.status ? error.message : '备份失败，请检查存储空间与远端连接'; job.completedAt = new Date(); await job.save(); throw error; }
}
export async function requireBackup(userId, id) { requireObjectId(id); const job = await BackupJob.findOne({ _id: id, userId }); if (!job) throw workbenchError('备份不存在', 404); return job; }
export async function backupDownload(userId, id) { const job = await requireBackup(userId, id); if (job.status !== 'completed' || job.type !== 'backup') throw workbenchError('备份文件尚未生成'); await stat(jobPath(job)); return { path: jobPath(job), filename: job.filename }; }
export async function deleteBackup(userId, id) { const job = await requireBackup(userId, id); if (job.status === 'running') throw workbenchError('不能删除正在运行的任务', 409); await rm(jobPath(job), { force: true }); await job.deleteOne(); }
async function withUploadedBackup(userId, upload, password, handler) {
  if (!upload || upload.size > 1024*1024*1024) throw workbenchError('备份文件最大 1 GB');
  const directory = path.join(root(), String(userId), `inspect-${crypto.randomUUID()}`); await mkdir(directory, { recursive: true });
  try {
    const encrypted = path.join(directory, 'encrypted'), decrypted = path.join(directory, 'archive.zip');
    // Uploaded bytes are written directly; only the authenticated archive is parsed.
    const { pipeline } = await import('node:stream/promises'); const { Readable } = await import('node:stream'); const { createWriteStream } = await import('node:fs');
    await pipeline(Readable.fromWeb(upload.stream()), createWriteStream(encrypted, { flags: 'wx', mode: 0o600 }));
    await decryptBackup(encrypted, decrypted, password).catch(error => { throw workbenchError(error.message.includes('密码') ? error.message : '备份文件无法解密'); });
    const entries = await extractZipFile(decrypted, path.join(directory, 'contents'), { maxBytes: 512*1024*1024, maxEntries: 100000 });
    const metadataEntry = entries.get('manifest.json'); if (!metadataEntry || metadataEntry.size > 50*1024*1024) throw workbenchError('备份目录缺失或过大');
    const metadata = await readFile(metadataEntry.path); const manifest = JSON.parse(metadata.toString('utf8')); const counts = validateManifest(manifest, entries);
    return await handler({ manifest, entries, counts, digest: crypto.createHash('sha256').update(metadata).digest('hex') });
  } finally { await rm(directory, { recursive: true, force: true }); }
}
export async function inspectBackup(userId, upload, password) {
  validatePassword(password); const job = await beginJob(userId, [], 'inspect');
  try { return await withUploadedBackup(userId, upload, password, async ({ manifest, counts, digest }) => ({ createdAt: manifest.createdAt, selection: manifest.selection, counts, digest, includesSettings: Boolean(manifest.settings), restoreMode: '所有内容恢复为新副本；只有勾选个人设置时才覆盖对应偏好。' })); }
  finally { await job.deleteOne(); }
}
export async function restoreBackup(userId, upload, password, options) {
  validatePassword(password); const job = await beginJob(userId, [], 'restore');
  try { return await withUploadedBackup(userId, upload, password, parsed => restoreArchive(userId, parsed, job, options)); }
  catch (error) { if (job.status === 'running') { job.status = 'failed'; job.error = '备份校验失败，未恢复内容'; job.completedAt = new Date(); await job.save(); } throw error; }
}
async function restoreArchive(userId, { manifest, entries, counts, digest: actualDigest }, job, { digest, applySettings = false }) {
  if (!digest || digest !== actualDigest) throw workbenchError('请先预览此备份，再确认恢复');
  job.selection = manifest.selection;
  const mappings = new Map(); const created = []; const createdFiles = [];
  try {
    for (const key of ['projects','conversations','folders','skills','assets','memories','documents']) for (const item of manifest[key]) mappings.set(item._id, String(new mongoose.Types.ObjectId()));
    const projectIds = new Set(manifest.projects.map(p => p._id)), conversationIds = new Set(manifest.conversations.map(c => c._id)), folderIds = new Set(manifest.folders.map(f => f._id));
    const copy = (item, keys) => ({ ...rewriteReferences(take(item, keys), mappings), _id: mappings.get(item._id), userId });
    const batches = [];
    const projects = manifest.projects.map(p => ({ ...copy(p, ['name','description','instructions','memoryEnabled']), name: `${p.name}（恢复副本）`.slice(0,100) })); batches.push([WorkspaceProject, projects]);
    const folders = manifest.folders.map(f => ({ ...copy(f, ['name','parentId']), name: f.parentId ? f.name : `${f.name.slice(0,170)}（恢复 ${String(job._id).slice(-8)}）` })); batches.push([FileFolder, folders]);
    const skills = manifest.skills.map(s => copy(s, ['name','description','content','metadata','enabled','source'])); batches.push([WorkbenchSkill, skills]);
    for (const [, docs] of batches) for (const doc of docs) if (!doc._id) throw new Error('备份记录映射失败');
    for (const [Model, docs] of batches) for (const doc of docs) await new Model(doc).validate();
    for (const file of manifest.files) {
      if (file.category !== 'document') { const handle = await open(entries.get(`files/${file.fileId}`).path, 'r'); const header = Buffer.alloc(64); try { await handle.read(header, 0, 64, 0); } finally { await handle.close(); } const media = inspectUploadedFile(header, file.extension); if (!media || media.mimeType !== file.mimeType || media.category !== file.category) throw workbenchError('备份中的媒体文件格式无效'); }
      let ownerType = 'library', ownerId = null;
      if (applySettings && file.kind === 'avatar' && [manifest.settings?.avatarFileId, manifest.settings?.assistant?.avatarFileId].includes(file.fileId)) { if (file.category !== 'image') throw workbenchError('备份头像不是图片'); ownerType = 'avatar'; ownerId = userId; }
      if (file.ownerType === 'project' && projectIds.has(file.ownerId)) { ownerType = 'project'; ownerId = mappings.get(file.ownerId); }
      if (file.ownerType === 'conversation' && conversationIds.has(file.ownerId)) { ownerType = 'conversation'; ownerId = mappings.get(file.ownerId); }
      const stored = await createStoredFileFromWebStream({ userId, input: Readable.toWeb(createReadStream(entries.get(`files/${file.fileId}`).path)), maxBytes: file.size, originalName: file.originalName, mimeType: file.mimeType, extension: file.extension, category: file.category, kind: ownerType === 'library' ? 'library' : ownerType === 'avatar' ? 'avatar' : file.kind, ownerType, ownerId });
      createdFiles.push(stored); stored.folderId = folderIds.has(file.folderId) ? mappings.get(file.folderId) : null; await stored.save(); mappings.set(file.fileId, stored.fileId);
    }
    const conversations = manifest.conversations.map(c => ({ ...rewriteReferences(safeConversation(c), mappings), _id: mappings.get(c._id), userId, title: `${c.title}（恢复副本）`, projectId: projectIds.has(c.projectId) ? mappings.get(c.projectId) : null, activeTaskId: null }));
    for (const asset of manifest.assets) { if (asset.size > 8*1024*1024) throw workbenchError('技能单个附件不能超过 8 MB'); assetPath(asset.path); }
    const memories = manifest.memories.map(m => ({ ...copy(m, ['content','source','createdAt','updatedAt']), conversationId: conversationIds.has(m.conversationId) ? mappings.get(m.conversationId) : null, projectId: projectIds.has(m.projectId) ? mappings.get(m.projectId) : null, scope: m.scope }));
    const documents = manifest.documents.filter(d => mappings.has(d.fileId)).map(d => ({ ...copy(d, ['fileId','tables','chunks']), projectId: projectIds.has(d.projectId) ? mappings.get(d.projectId) : null, conversationId: conversationIds.has(d.conversationId) ? mappings.get(d.conversationId) : null }));
    batches.push([Conversation, conversations], [WorkbenchMemory, memories], [WorkspaceDocument, documents]);
    for (const [Model, docs] of batches) for (const doc of docs) await new Model(doc).validate();
    for (const [Model, docs] of batches) { if (!docs.length) continue; created.push([Model, docs.map(d => d._id)]); await Model.insertMany(docs); }
    created.push([SkillAsset, manifest.assets.map(asset => mappings.get(asset._id))]);
    for (const asset of manifest.assets) await SkillAsset.create({ ...copy(asset, ['skillId','size','executable']), path: asset.path, data: await readFile(entries.get(`assets/${asset._id}`).path) });
    if (applySettings && manifest.settings) { const settings = safeSettings(manifest.settings); for (const avatar of [settings.avatarFileId, settings.assistant?.avatarFileId]) if (avatar && !mappings.has(avatar)) throw workbenchError('备份缺少头像文件，请选择包含文件的完整备份'); const restoredSettings = rewriteReferences(settings, mappings); Object.assign(restoredSettings, validatePreferences({ assistant: restoredSettings.assistant, appearance: restoredSettings.appearance })); await UserSettings.updateOne({ userId }, { $set: restoredSettings }, { upsert: true, runValidators: true }); }
    job.status = 'completed'; job.completedAt = new Date(); job.counts = counts; await job.save(); return { job, counts };
  } catch (error) {
    for (const [Model, ids] of created.reverse()) await Model.deleteMany({ userId, _id: { $in: ids } });
    for (const file of createdFiles) await deleteStoredFileDocument(file);
    job.status = 'failed'; job.error = '恢复未完成，已移除本次新建内容'; job.completedAt = new Date(); await job.save(); throw error;
  }
}
export async function saveSchedule(userId, body, id) {
  const selection = selectSections(body.selection); const password = validatePassword(body.password);
  if (!['daily','weekly'].includes(body.frequency) || !Number.isInteger(body.hour) || body.hour < 0 || body.hour > 23 || !Number.isInteger(body.minute) || body.minute < 0 || body.minute > 59 || !Number.isInteger(body.weekday) || body.weekday < 0 || body.weekday > 6) throw workbenchError('备份时间无效');
  if (body.destination?.connectionId && !body.destination.path?.trim()) throw workbenchError('请填写远端保存路径');
  const schedule = id ? await BackupSchedule.findOne({ _id: requireObjectId(id), userId }) : new BackupSchedule({ userId }); if (!schedule) throw workbenchError('定时备份不存在', 404);
  schedule.set({ selection, frequency: body.frequency, hour: body.hour, minute: body.minute, weekday: body.weekday, destination: body.destination, enabled: body.enabled !== false, encryptedPassword: encryptSecret(password, `backup-schedule:${userId}:${schedule._id}`) });
  schedule.nextRunAt = nextScheduleRun(schedule); await schedule.save(); return BackupSchedule.findById(schedule._id).lean();
}
export async function runDueBackups(now = new Date()) {
  const due = await BackupSchedule.find({ enabled: true, nextRunAt: { $lte: now } }).select('+encryptedPassword').sort({ nextRunAt: 1 });
  for (const schedule of due) {
    const claimed = await BackupSchedule.updateOne({ _id: schedule._id, enabled: true, nextRunAt: schedule.nextRunAt }, { $set: { nextRunAt: nextScheduleRun(schedule, now), lastRunAt: now, lastError: null } });
    if (!claimed.modifiedCount) continue;
    try { await createBackup(String(schedule.userId), { selection: schedule.selection, password: decryptSecret(schedule.encryptedPassword, `backup-schedule:${schedule.userId}:${schedule._id}`), destination: schedule.destination, scheduleId: schedule._id }); }
    catch (error) { await BackupSchedule.updateOne({ _id: schedule._id }, { $set: { lastError: error.status === 409 ? error.message : '定时备份失败，请检查密码配置、存储空间与远端连接' } }); }
  }
}
export async function recoverInterruptedBackups() { await BackupJob.updateMany({ status: 'running' }, { $set: { status: 'failed', error: '服务重启导致任务中断，请重新操作', completedAt: new Date() } }); }
export async function deleteUserBackups(userId) { await BackupSchedule.deleteMany({ userId }); await BackupJob.deleteMany({ userId }); await rm(path.join(root(), String(userId)), { recursive: true, force: true }); }
