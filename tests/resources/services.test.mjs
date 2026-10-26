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
const { saveAdminModelSettings } = await import('../../lib/server/models/service.js');
const { DEFAULT_MODEL_SETTINGS } = await import('../../lib/server/models/config.js');
let database;
test.before(async () => {
  database = await MongoMemoryServer.create(); await mongoose.connect(database.getUri()); global.mongoose.conn = mongoose;
  await saveAdminModelSettings({ ...DEFAULT_MODEL_SETTINGS, baseUrl: 'https://example.com/v1', protocol: 'responses', modelId: 'test-model', displayName: '测试模型', apiKey: 'resource-test-only-key' }, userId);
});
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

test('renaming a binary file cannot make it editable as text', async () => {
  const owner = String(new mongoose.Types.ObjectId());
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lCEAAAAASUVORK5CYII=', 'base64');
  const [image] = await files.uploadLibrary(owner, [new File([png], 'image.png', { type: 'image/png' })], null);
  const renamed = await files.updateFile(owner, image.fileId, { name: 'image.txt' });
  assert.equal(renamed.editable, false);
  await assert.rejects(() => files.readText(owner, image.fileId), /文本文件/);
  await assert.rejects(() => files.updateFile(owner, image.fileId, { content: 'replacement' }), /文本文件/);
  const { readStoredFileBuffer } = await import('../../lib/server/storage/service.js');
  assert.deepEqual(await readStoredFileBuffer(await files.requireFile(owner, image.fileId)), png);
  assert.equal(files.textFile({ category: 'document', mimeType: 'application/pdf', extension: 'pdf', originalName: 'renamed.txt' }), false);
});

test('concurrent first settings saves and prompt additions preserve every update', async () => {
  const settings = await import('../../lib/server/settings/service.js');
  await UserSettings.init();
  const owner = String(new mongoose.Types.ObjectId());
  await Promise.all([
    settings.updateUserProfileSettings(owner, { nickname: '并发保存' }),
    settings.updateUserProfileSettings(owner, { chatSystemPrompt: '请注明来源' }),
  ]);
  const prompts = Array.from({ length: 6 }, (_, i) => ({ name: `提示 ${i}`, content: `内容 ${i}` }));
  await Promise.all(prompts.map(prompt => settings.addUserPrompt(owner, prompt)));
  const saved = await UserSettings.findOne({ userId: owner });
  assert.equal(await UserSettings.countDocuments({ userId: owner }), 1);
  assert.equal(saved.nickname, '并发保存');
  assert.equal(saved.chatSystemPrompt, '请注明来源');
  assert.deepEqual(saved.systemPrompts.map(({ name, content }) => ({ name, content })).sort((a, b) => a.name.localeCompare(b.name)), prompts);
});

test('a stale prompt deletion cannot overwrite a concurrent addition', async t => {
  const settings = await import('../../lib/server/settings/service.js');
  const owner = String(new mongoose.Types.ObjectId());
  const first = await settings.addUserPrompt(owner, { name: '原有提示', content: '原有内容' });
  const stale = await UserSettings.findOne({ userId: owner });
  await settings.addUserPrompt(owner, { name: '同时新增', content: '保留新内容' });
  const find = t.mock.method(UserSettings, 'findOne', async () => stale);
  try {
    await assert.rejects(settings.deleteUserPrompt(owner, String(first.systemPrompts[0]._id)), mongoose.Error.VersionError);
  } finally {
    find.mock.restore();
  }
  const saved = await UserSettings.findOne({ userId: owner });
  assert.deepEqual(saved.systemPrompts.map(prompt => prompt.name), ['原有提示', '同时新增']);
});

test('administrator skills share one revision across users and preserve attachments', async () => {
  const source = 'https://github.com/example/skills';
  const files = new Map([['SKILL.md', Buffer.from('---\nname: document-review\ndescription: 整理资料\nlicense: MIT\n---\n工作步骤')], ['scripts/run.py', Buffer.from('print("reference")')]]);
  await skills.publishInstalledSkills(source, [{slug:'document-review',files}]);
  const skill = await WorkbenchSkill.findOne({managed:true});
  assert.equal(skill.metadata.license, 'MIT');
  const assets = await skills.skillAssets(String(skill._id)); assert.equal(assets[0].executable, true);
  const handlers = skills.createSkillToolHandlers({ enabledSkillIds: [String(skill._id)] });
  assert.equal((await handlers.read_skill_file({ skillId: String(skill._id), path: 'scripts/run.py' })).executable, false);
  await assert.rejects(() => skills.createSkillToolHandlers({ enabledSkillIds: [] }).load_skill({ skillId: String(skill._id) }), /管理员启用/);
  assert.equal((await skills.listEnabledSkills()).length, 1);
  await assert.rejects(() => skills.publishInstalledSkills('https://github.com/another/skills', [{slug:'document-review',files}]), /同名技能/);
  const oldRevision = skill.revision;
  files.set('scripts/run.py', Buffer.from('updated reference'));
  await skills.publishInstalledSkills(source, [{slug:'document-review',files}]);
  const updated = await skills.requireSkill(String(skill._id));
  assert.notEqual(updated.revision, oldRevision);
  assert.equal(await SkillAsset.countDocuments({skillId:skill._id,revision:oldRevision}), 0);
  assert.equal((await skills.readSkillAsset(String(skill._id),'scripts/run.py')).data.toString(), 'updated reference');
  await skills.setManagedSkillEnabled(String(skill._id),false);
  assert.equal((await skills.listEnabledSkills()).length, 0);
  await assert.rejects(() => handlers.load_skill({skillId:String(skill._id)}), /停用/);
  await skills.setManagedSkillEnabled(String(skill._id),true);
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
  const job = await backups.createBackup(userId, { selection: ['conversations','projects','files','settings'], password: 'long-test-password' });
  const download = await backups.backupDownload(userId, String(job._id)); const upload = new File([await readFile(download.path)], 'backup.vxb');
  await assert.rejects(() => backups.backupDownload(other, String(job._id)), /不存在/);
  const preview = await backups.inspectBackup(userId, upload, 'long-test-password'); assert.equal(preview.counts.conversations, 1); assert.equal(preview.counts.skills, undefined);
  await assert.rejects(() => backups.restoreBackup(userId, upload, 'long-test-password', { digest: 'wrong' }), /先预览/);
  await UserSettings.updateOne({ userId }, { $set: { nickname: '现在姓名', permissions: { browser: false } } });
  await backups.restoreBackup(userId, upload, 'long-test-password', { digest: preview.digest, applySettings: true });
  const restored = await Conversation.findOne({ userId, _id: { $ne: conversation._id } }); assert.ok(restored.title.includes('恢复副本')); assert.notEqual(String(restored.projectId), String(project._id));
  const restoredId = restored.messages[0].parts[0].fileData.fileId; assert.notEqual(restoredId, file.fileId); assert.ok(restored.messages[0].content.includes(restoredId)); assert.ok(await StoredFile.exists({ userId, fileId: restoredId })); assert.equal(restored.messages[0].providerState, undefined);
  const settings = await UserSettings.findOne({ userId }); assert.equal(settings.nickname, '备份姓名'); assert.equal(settings.permissions.browser, false);
  assert.equal(await WorkbenchSkill.countDocuments({ managed: true }), 1); assert.equal(await SkillAsset.countDocuments({}), 1);
  await BackupJob.create({ userId, status: 'running' }); await assert.rejects(() => backups.createBackup(other, { selection: ['settings'], password: 'long-test-password' }), /已有备份/);
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

test('real task registry reads shared indexed files and sends global skill images as multimodal input', async () => {
  const { createTaskTools } = await import('../../lib/server/workbench/tools.js');
  const { default: WorkbenchTask } = await import('../../models/WorkbenchTask.js');
  const { default: WorkbenchTaskEvent } = await import('../../models/WorkbenchTaskEvent.js');
  const conversation = await Conversation.create({ userId, title: 'registry', messages: [{ id: 'registry-model', role: 'model', content: '', thinkingTimeline: [] }] });
  const task = await WorkbenchTask.create({ userId, conversationId: conversation._id, requestId: 'registry-test', fingerprint: 'registry-test', userMessageId: 'registry-user', modelMessageId: 'registry-model', model: 'deepseek-flash', status: 'running' });
  const skill = await WorkbenchSkill.findOne({ managed: true });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lCEAAAAASUVORK5CYII=', 'base64');
  await SkillAsset.create({ revision: skill.revision, skillId: skill._id, path: 'pixel.png', data: png, size: png.length });
  const [file] = await files.uploadLibrary(userId, [new File(['跨项目共享内容42'], 'registry-shared.txt', { type: 'text/plain' })], null);
  const registry = await createTaskTools(task, new AbortController().signal, async () => {});
  const call = (name, args) => registry.execute({ id: `call-${Math.random()}`, name, arguments: JSON.stringify(args) });
  assert.match(await call('read_document', { fileId: file.fileId, offset: 0, limit: 10 }), /跨项目共享内容42/);
  assert.match(await call('read_file', { fileId: file.fileId }), /跨项目共享内容42/);
  for (const protocol of ['chat', 'responses', 'messages']) {
    const result = await call('read_skill_file', { skillId: String(skill._id), path: 'pixel.png' }); assert.match(result, /loaded/); assert.equal(result.includes(png.toString('base64')), false);
    const messages = await registry.prepareMessages([], { protocol }); assert.ok(JSON.stringify(messages).includes(png.toString('base64'))); assert.ok(JSON.stringify(messages).includes('image/png'));
  }
  const logs = await WorkbenchTaskEvent.find({ taskId: task._id }).lean(); assert.equal(JSON.stringify(logs).includes(png.toString('base64')), false);
  await WorkbenchTask.updateOne({ _id: task._id }, { $set: { status: 'completed' } });
});

test('scheduled backups store encrypted passwords and execute a due run once', async () => {
  const { default: BackupSchedule } = await import('../../models/BackupSchedule.js');
  const schedule = await backups.saveSchedule(userId, { selection: ['settings'], password: 'schedule-password-2026', frequency: 'weekly', hour: 2, minute: 30, weekday: 1 });
  assert.equal(schedule.encryptedPassword, undefined);
  const secret = await BackupSchedule.findById(schedule._id).select('+encryptedPassword').lean(); assert.equal(JSON.stringify(secret).includes('schedule-password-2026'), false);
  const now = new Date(); await BackupSchedule.updateOne({ _id: schedule._id }, { $set: { nextRunAt: new Date(now.getTime()-1000) } });
  await backups.runDueBackups(now); const after = await BackupSchedule.findById(schedule._id); assert.ok(after.nextRunAt > now); assert.equal(after.lastError, null);
  assert.equal(await BackupJob.countDocuments({ scheduleId: schedule._id, status: 'completed' }), 1);
  await backups.runDueBackups(now); assert.equal(await BackupJob.countDocuments({ scheduleId: schedule._id }), 1);
});

test('streamed restore preserves avatar ownership; inspection is globally locked', async () => {
  const { createStoredFile } = await import('../../lib/server/storage/service.js');
  const avatar = await createStoredFile({ userId, input: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lCEAAAAASUVORK5CYII=', 'base64'), originalName: 'avatar.png', mimeType: 'image/png', extension: 'png', category: 'image', kind: 'avatar', ownerType: 'avatar', ownerId: userId });
  await UserSettings.updateOne({ userId }, { $set: { avatarFileId: avatar.fileId, assistant: { name: '测试助手', avatarFileId: avatar.fileId } } });
  const job = await backups.createBackup(userId, { selection: ['files','settings','conversations','projects'], password: 'roundtrip-password-2026' });
  const upload = new File([await readFile((await backups.backupDownload(userId, String(job._id))).path)], 'roundtrip.vxb');
  await assert.rejects(() => backups.inspectBackup(userId, upload, 'incorrect-password'), /密码错误/); assert.equal(await BackupJob.countDocuments({ status: 'running' }), 0);
  const locked = await BackupJob.create({ userId, status: 'running' }); await assert.rejects(() => backups.inspectBackup(other, upload, 'roundtrip-password-2026'), /已有备份/); await locked.deleteOne();
  const preview = await backups.inspectBackup(userId, upload, 'roundtrip-password-2026'); await backups.restoreBackup(userId, upload, 'roundtrip-password-2026', { digest: preview.digest, applySettings: true });
  const settings = await UserSettings.findOne({ userId }); assert.notEqual(settings.avatarFileId, avatar.fileId); assert.equal(settings.assistant.avatarFileId, settings.avatarFileId);
  const restoredAvatar = await StoredFile.findOne({ userId, fileId: settings.avatarFileId }); assert.equal(restoredAvatar.ownerType, 'avatar'); assert.equal(restoredAvatar.ownerId, userId); assert.equal(restoredAvatar.kind, 'avatar');
  assert.equal(settings.chatMediaSettings, undefined);
});
