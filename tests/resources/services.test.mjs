import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const directory = await mkdtemp(path.join(os.tmpdir(), 'vectaix-resource-tests-'));
process.env.STORAGE_ROOT = directory; process.env.MONGO_URI = 'mongodb://127.0.0.1/test'; process.env.APP_SECRETS_KEY = randomBytes(32).toString('base64');
const { default: WorkbenchSkill } = await import('../../models/WorkbenchSkill.js');
const { default: SkillAsset } = await import('../../models/SkillAsset.js');
const { default: StoredFile } = await import('../../models/StoredFile.js');
const { default: FileFolder } = await import('../../models/FileFolder.js');
const { default: WorkspaceProject } = await import('../../models/WorkspaceProject.js');
const { default: Conversation } = await import('../../models/Conversation.js');
const { default: UserSettings } = await import('../../models/UserSettings.js');
const { default: BackupJob } = await import('../../models/BackupJob.js');
const skills = await import('../../lib/server/skills/service.js');
const files = await import('../../lib/server/files/service.js');
const backups = await import('../../lib/server/backups/service.js');
const { zipStream } = await import('../../lib/server/skills/archive.mjs');
let database;
test.before(async () => { database = await MongoMemoryServer.create(); await mongoose.connect(database.getUri()); global.mongoose.conn = mongoose; });
test.after(async () => { await mongoose.disconnect(); await database?.stop(); await rm(directory, { recursive: true, force: true }); });
const userId = String(new mongoose.Types.ObjectId()), other = String(new mongoose.Types.ObjectId());

test('library exposes deletion reasons and rejects a mixed batch before deleting any file', async () => {
  const owner = String(new mongoose.Types.ObjectId());
  const [ordinary, managed] = await files.uploadLibrary(owner, [new File(['ordinary'], 'ordinary.txt'), new File(['managed'], 'generated.txt')], null);
  await StoredFile.updateOne({ fileId: managed.fileId }, { $set: { ownerType: 'image-result' } });
  const listing = await files.listLibrary(owner, null);
  assert.equal(listing.files.find(file => file.fileId === ordinary.fileId).deletionBlockedReason, null);
  assert.match(listing.files.find(file => file.fileId === managed.fileId).deletionBlockedReason, /图片生成/);
  await assert.rejects(() => files.deleteLibraryFiles(owner, [ordinary.fileId, managed.fileId]), error => error.status === 409 && /generated.txt/.test(error.message));
  assert.equal(await StoredFile.countDocuments({ userId: owner }), 2);
  await assert.rejects(() => files.deleteLibraryFiles(other, [ordinary.fileId]), /不存在/);
  await files.deleteLibraryFiles(owner, [ordinary.fileId]);
  assert.equal(await StoredFile.exists({ fileId: ordinary.fileId }), null);
  assert.ok(await StoredFile.exists({ fileId: managed.fileId }));
});

test('library reports reference restrictions and rechecks them when deleting a batch', async () => {
  const owner = String(new mongoose.Types.ObjectId());
  const [first, referenced] = await files.uploadLibrary(owner, [new File(['first'], 'first.txt'), new File(['reference'], 'reference.txt')], null);
  assert.equal((await files.listLibrary(owner, null)).files[0].deletionBlockedReason, null);
  await Conversation.create({ userId: owner, title: '引用', messages: [{ role: 'user', content: `/api/files/${referenced.fileId}` }] });
  assert.match((await files.listLibrary(owner, null)).files.find(file => file.fileId === referenced.fileId).deletionBlockedReason, /仍被/);
  await assert.rejects(() => files.deleteLibraryFiles(owner, [first.fileId, referenced.fileId]), /reference.txt/);
  assert.equal(await StoredFile.countDocuments({ userId: owner }), 2);
});

test('skill ZIP import retains metadata and assets, owner scope, edit and export', async () => {
  const chunks = []; for await (const chunk of zipStream([{ name: 'demo/SKILL.md', buffer: Buffer.from('---\nname: 文档整理\ndescription: 整理资料\nlicense: MIT\n---\n工作步骤') }, { name: 'demo/scripts/run.py', buffer: Buffer.from('print("stored only")') }])) chunks.push(chunk);
  const skill = await skills.importSkill(userId, { name: 'demo.skill', buffer: Buffer.concat(chunks) });
  assert.equal(skill.metadata.license, 'MIT');
  const assets = await skills.skillAssets(userId, String(skill._id)); assert.equal(assets[0].executable, true);
  await assert.rejects(() => skills.readSkillAsset(other, String(skill._id), assets[0].path), /不存在/);
  const handlers = skills.createSkillToolHandlers({ userId, enabledSkillIds: [String(skill._id)] }); assert.equal((await handlers.read_skill_file({ skillId: String(skill._id), path: 'scripts/run.py' })).executable, false);
  await assert.rejects(() => skills.createSkillToolHandlers({ userId, enabledSkillIds: [] }).load_skill({ skillId: String(skill._id) }), /未在当前对话启用/);
  const output = []; for await (const chunk of await skills.exportSkill(userId, String(skill._id))) output.push(chunk); assert.ok(Buffer.concat(output).length > 100);
});
test('library folder ownership, hierarchy, text editing, project copy', async () => {
  const folder = await FileFolder.create({ userId, name: '资料' }), child = await FileFolder.create({ userId, name: '子目录', parentId: folder._id });
  await assert.rejects(() => files.updateFolder(userId, String(folder._id), { parentId: String(child._id) }), /子文件夹/);
  const [file] = await files.uploadLibrary(userId, [new File(['hello world'], 'hello.txt', { type: 'text/plain' })], String(folder._id));
  await assert.rejects(() => files.updateFile(other, file.fileId, { name: 'stolen.txt' }), /不存在/);
  await files.updateFile(userId, file.fileId, { name: 'edited.txt', content: '新的内容', folderId: null }); assert.equal(await files.readText(userId, file.fileId), '新的内容');
  const project = await WorkspaceProject.create({ userId, name: '测试项目' }); const copied = await files.copyToProject(userId, file.fileId, String(project._id)); assert.notEqual(copied.fileId, file.fileId); assert.equal(copied.ownerId, String(project._id));
});
test('full encrypted backup preview and restore makes owned copies and remaps file links', async () => {
  const file = await StoredFile.findOne({ userId, ownerType: 'library' }); const project = await WorkspaceProject.findOne({ userId });
  const conversation = await Conversation.create({ userId, title: '原始对话', projectId: project._id, messages: [{ role: 'user', content: `参考 /api/files/${file.fileId}`, parts: [{ fileData: { fileId: file.fileId, url: `/api/files/${file.fileId}` } }], providerState: { token: 'SECRET' } }] });
  await UserSettings.create({ userId, nickname: '备份姓名', permissions: { browser: true }, assistant: { name: '测试助手' } });
  const job = await backups.createBackup(userId, { selection: ['conversations','projects','files','skills','memories','settings'], password: 'long-test-password' });
  const download = await backups.backupDownload(userId, String(job._id)); const upload = new File([await readFile(download.path)], 'backup.vxb');
  await assert.rejects(() => backups.backupDownload(other, String(job._id)), /不存在/);
  const preview = await backups.inspectBackup(userId, upload, 'long-test-password'); assert.equal(preview.counts.conversations, 1); assert.equal(preview.counts.skills, 1);
  await assert.rejects(() => backups.restoreBackup(userId, upload, 'long-test-password', { digest: 'wrong' }), /先预览/);
  await UserSettings.updateOne({ userId }, { $set: { nickname: '现在姓名', permissions: { browser: false } } });
  await backups.restoreBackup(userId, upload, 'long-test-password', { digest: preview.digest, applySettings: true });
  const restored = await Conversation.findOne({ userId, _id: { $ne: conversation._id } }); assert.ok(restored.title.includes('恢复副本')); assert.notEqual(String(restored.projectId), String(project._id));
  const restoredId = restored.messages[0].parts[0].fileData.fileId; assert.notEqual(restoredId, file.fileId); assert.ok(restored.messages[0].content.includes(restoredId)); assert.ok(await StoredFile.exists({ userId, fileId: restoredId })); assert.equal(restored.messages[0].providerState, undefined);
  const settings = await UserSettings.findOne({ userId }); assert.equal(settings.nickname, '备份姓名'); assert.equal(settings.permissions.browser, false);
  assert.equal(await WorkbenchSkill.countDocuments({ userId }), 2); assert.equal(await SkillAsset.countDocuments({ userId }), 2);
  await BackupJob.create({ userId, status: 'running' }); await assert.rejects(() => backups.createBackup(other, { selection: ['skills'], password: 'long-test-password' }), /已有备份/);
  await BackupJob.deleteMany({ status: 'running' });
});

test('usage is owner scoped and excludes diagnostic payloads; cleanup protects referenced files', async () => {
  const { usageSummary, toolLogs, storageSummary, cleanupStorage } = await import('../../lib/server/usage/service.js');
  const { default: CreditTransaction } = await import('../../models/CreditTransaction.js');
  const { default: WorkbenchTaskEvent } = await import('../../models/WorkbenchTaskEvent.js');
  const taskId = new mongoose.Types.ObjectId();
  await CreditTransaction.create([{ userId, auditUserKey: 'test', operationId: 'usage-one', type: 'model_usage', status: 'settled', model: 'test-model', actualCostCny: 0.42, usage: { taskId: String(taskId) } }, { userId: other, auditUserKey: 'other', operationId: 'usage-other', type: 'model_usage', status: 'settled', model: 'test-model', actualCostCny: 9 }]);
  await WorkbenchTaskEvent.create({ userId, taskId, seq: 1, type: 'tool', message: 'SECRET', data: { name: 'read_file', arguments: { password: 'SECRET' }, result: 'SECRET', durationMs: 20 } });
  const usage = await usageSummary(userId, new URLSearchParams()); assert.equal(usage.summary.costCny, 0.42); assert.equal(usage.models[0]._id, 'test-model');
  const logs = await toolLogs(userId, new URLSearchParams()); assert.equal(logs[0].tool, 'read_file'); assert.equal(JSON.stringify(logs).includes('SECRET'), false);
  const [unreferenced] = await files.uploadLibrary(userId, [new File(['unused'], 'unused.txt', { type: 'text/plain' })], null);
  const storage = await storageSummary(userId); assert.ok(storage.cleanupCandidates.some(f => f.fileId === unreferenced.fileId));
  const referenced = (await Conversation.findOne({ userId })).messages[0].parts[0].fileData.fileId;
  await assert.rejects(() => cleanupStorage(userId, [referenced]), /正在被使用/);
  await assert.rejects(() => files.deleteLibraryFile(userId, referenced), /仍被/);
  assert.equal((await cleanupStorage(userId, [unreferenced.fileId])).deleted, 1);
  assert.equal(await StoredFile.exists({ fileId: unreferenced.fileId }), null);
});

test('real task registry reads shared indexed files and sends skill images as multimodal input in four protocols', async () => {
  const { createTaskTools } = await import('../../lib/server/workbench/tools.js');
  const { default: WorkbenchTask } = await import('../../models/WorkbenchTask.js');
  const { default: WorkbenchTaskEvent } = await import('../../models/WorkbenchTaskEvent.js');
  const conversation = await Conversation.create({ userId, title: 'registry', messages: [{ id: 'registry-model', role: 'model', content: '', thinkingTimeline: [] }] });
  const task = await WorkbenchTask.create({ userId, conversationId: conversation._id, requestId: 'registry-test', fingerprint: 'registry-test', userMessageId: 'registry-user', modelMessageId: 'registry-model', model: 'google/gemini-3.8-flash', status: 'running' });
  const skill = await WorkbenchSkill.findOne({ userId });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lCEAAAAASUVORK5CYII=', 'base64');
  await SkillAsset.create({ userId, skillId: skill._id, path: 'pixel.png', data: png, size: png.length });
  const [file] = await files.uploadLibrary(userId, [new File(['跨项目共享内容42'], 'registry-shared.txt', { type: 'text/plain' })], null);
  const registry = await createTaskTools(task, new AbortController().signal, async () => {});
  const call = (name, args) => registry.execute({ id: `call-${Math.random()}`, name, arguments: JSON.stringify(args) });
  assert.match(await call('read_document', { fileId: file.fileId, offset: 0, limit: 10 }), /跨项目共享内容42/);
  assert.match(await call('read_file', { fileId: file.fileId }), /跨项目共享内容42/);
  for (const protocol of ['chat-completions', 'responses', 'anthropic', 'gemini']) {
    const result = await call('read_skill_file', { skillId: String(skill._id), path: 'pixel.png' }); assert.match(result, /loaded/); assert.equal(result.includes(png.toString('base64')), false);
    const messages = await registry.prepareMessages([], { protocol }); assert.ok(JSON.stringify(messages).includes(png.toString('base64'))); assert.ok(JSON.stringify(messages).includes('image/png'));
  }
  const logs = await WorkbenchTaskEvent.find({ taskId: task._id }).lean(); assert.equal(JSON.stringify(logs).includes(png.toString('base64')), false);
  await WorkbenchTask.updateOne({ _id: task._id }, { $set: { status: 'completed' } });
});

test('scheduled backups store encrypted passwords and execute a due run once', async () => {
  const { default: BackupSchedule } = await import('../../models/BackupSchedule.js');
  const schedule = await backups.saveSchedule(userId, { selection: ['skills'], password: 'schedule-password-2026', frequency: 'weekly', hour: 2, minute: 30, weekday: 1 });
  assert.equal(schedule.encryptedPassword, undefined);
  const secret = await BackupSchedule.findById(schedule._id).select('+encryptedPassword').lean(); assert.equal(JSON.stringify(secret).includes('schedule-password-2026'), false);
  const now = new Date(); await BackupSchedule.updateOne({ _id: schedule._id }, { $set: { nextRunAt: new Date(now.getTime()-1000) } });
  await backups.runDueBackups(now); const after = await BackupSchedule.findById(schedule._id); assert.ok(after.nextRunAt > now); assert.equal(after.lastError, null);
  assert.equal(await BackupJob.countDocuments({ scheduleId: schedule._id, status: 'completed' }), 1);
  await backups.runDueBackups(now); assert.equal(await BackupJob.countDocuments({ scheduleId: schedule._id }), 1);
});

test('streamed restore preserves avatar ownership, media preferences and memory provenance; inspection is globally locked', async () => {
  const { createStoredFile } = await import('../../lib/server/storage/service.js');
  const { default: WorkbenchMemory } = await import('../../models/WorkbenchMemory.js');
  const avatar = await createStoredFile({ userId, input: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lCEAAAAASUVORK5CYII=', 'base64'), originalName: 'avatar.png', mimeType: 'image/png', extension: 'png', category: 'image', kind: 'avatar', ownerType: 'avatar', ownerId: userId });
  await UserSettings.updateOne({ userId }, { $set: { avatarFileId: avatar.fileId, assistant: { name: '测试助手', avatarFileId: avatar.fileId }, chatMediaSettings: { image: { size: '1K', password: 'SECRET' }, audio: { provider: 'qwen', voiceId: 'Cherry', format: 'mp3', rate: 1, apiKey: 'SECRET' } } } });
  const origin = await Conversation.findOne({ userId }); const memoryId = new mongoose.Types.ObjectId(), date = new Date('2025-01-02T03:04:05Z');
  await WorkbenchMemory.collection.insertOne({ _id: memoryId, userId: new mongoose.Types.ObjectId(userId), projectId: null, conversationId: origin._id, scope: 'personal', content: '保留来源时间', source: 'automatic', createdAt: date, updatedAt: date });
  const job = await backups.createBackup(userId, { selection: ['files','settings','memories','conversations','projects'], password: 'roundtrip-password-2026' });
  const upload = new File([await readFile((await backups.backupDownload(userId, String(job._id))).path)], 'roundtrip.vxb');
  await assert.rejects(() => backups.inspectBackup(userId, upload, 'incorrect-password'), /密码错误/); assert.equal(await BackupJob.countDocuments({ status: 'running' }), 0);
  const locked = await BackupJob.create({ userId, status: 'running' }); await assert.rejects(() => backups.inspectBackup(other, upload, 'roundtrip-password-2026'), /已有备份/); await locked.deleteOne();
  const preview = await backups.inspectBackup(userId, upload, 'roundtrip-password-2026'); await backups.restoreBackup(userId, upload, 'roundtrip-password-2026', { digest: preview.digest, applySettings: true });
  const settings = await UserSettings.findOne({ userId }); assert.notEqual(settings.avatarFileId, avatar.fileId); assert.equal(settings.assistant.avatarFileId, settings.avatarFileId);
  const restoredAvatar = await StoredFile.findOne({ userId, fileId: settings.avatarFileId }); assert.equal(restoredAvatar.ownerType, 'avatar'); assert.equal(restoredAvatar.ownerId, userId); assert.equal(restoredAvatar.kind, 'avatar');
  assert.equal(settings.chatMediaSettings.audio.voiceId, 'Cherry'); assert.equal(JSON.stringify(settings.chatMediaSettings).includes('SECRET'), false);
  const memory = await WorkbenchMemory.findOne({ userId, content: '保留来源时间', _id: { $ne: memoryId } }); assert.equal(memory.createdAt.toISOString(), date.toISOString()); assert.equal(memory.updatedAt.toISOString(), date.toISOString()); assert.notEqual(String(memory.conversationId), String(origin._id)); assert.ok(await Conversation.exists({ _id: memory.conversationId, userId }));
});
