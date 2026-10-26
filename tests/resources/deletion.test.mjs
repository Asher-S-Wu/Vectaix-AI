import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const directory = await mkdtemp(path.join(os.tmpdir(), 'vectaix-deletion-tests-'));
process.env.STORAGE_ROOT = directory;
process.env.MONGO_URI = 'mongodb://127.0.0.1/test';
process.env.APP_SECRETS_KEY = randomBytes(32).toString('base64');
const { default: Conversation } = await import('../../models/Conversation.js');
const { default: WorkspaceProject } = await import('../../models/WorkspaceProject.js');
const { default: WorkbenchTask } = await import('../../models/WorkbenchTask.js');
const { default: StoredFile } = await import('../../models/StoredFile.js');
const { createStoredFile, readStoredFileBuffer } = await import('../../lib/server/storage/service.js');
const { updateConversationForUser, deleteConversationForUser } = await import('../../lib/server/conversations/service.js');
const { deleteProjectDocument, deleteConversationDocument } = await import('../../lib/server/workbench/documents.js');
const catalog = await import('../../lib/server/workbench/catalog.js');
const backups = await import('../../lib/server/backups/service.js');
const { default: BackupSchedule } = await import('../../models/BackupSchedule.js');
let database;
test.before(async () => { database = await MongoMemoryServer.create(); await mongoose.connect(database.getUri()); global.mongoose.conn = mongoose; });
test.after(async () => { clearInterval(globalThis.__vectaixWorkbench?.timer); await mongoose.disconnect(); await database.stop(); await rm(directory, { recursive: true, force: true }); });
const id = () => String(new mongoose.Types.ObjectId());
const attachment = file => ({ fileData: { fileId: file.fileId, url: `/api/files/${file.fileId}` } });
const makeFile = (userId, ownerType, ownerId) => createStoredFile({ userId, input: Buffer.from('referenced bytes'), originalName: 'shared.txt', mimeType: 'text/plain', extension: 'txt', category: 'document', kind: ownerType === 'project' ? 'project-document' : 'task-artifact', ownerType, ownerId });

test('deleting a task reply protects artifacts reused by a retained message', async () => {
  const userId = id(), taskId = id(), conversationId = id();
  const file = await makeFile(userId, 'task', taskId);
  await WorkbenchTask.create({ _id: taskId, userId, conversationId, requestId: id(), fingerprint: 'delete', userMessageId: 'question', modelMessageId: 'answer', model: 'test', status: 'completed', artifacts: [{ fileId: file.fileId }] });
  await Conversation.create({ _id: conversationId, userId, title: '复用成果的对话', messages: [{ id: 'question', role: 'user', content: '制作文件' }, { id: 'answer', role: 'model', content: '已完成', taskId, artifacts: [{ fileId: file.fileId }] }, { id: 'reuse', role: 'user', parts: [attachment(file)] }] });
  await assert.rejects(() => updateConversationForUser(conversationId, userId, { deleteMessageId: 'answer' }), error => error.status === 409 && /shared.txt/.test(error.message) && /复用成果的对话/.test(error.message));
  assert.equal((await Conversation.findById(conversationId)).messages.length, 3);
  assert.ok(await WorkbenchTask.exists({ _id: taskId }));
  assert.equal((await readStoredFileBuffer(file)).toString(), 'referenced bytes');
  await updateConversationForUser(conversationId, userId, { deleteMessageId: 'reuse' });
  await updateConversationForUser(conversationId, userId, { deleteMessageId: 'answer' });
  assert.equal(await StoredFile.exists({ fileId: file.fileId }), null);
});

test('project file and project deletion reject referenced shared files before changing records', async () => {
  const userId = id(), project = await WorkspaceProject.create({ userId, name: '保留附件项目' });
  const file = await makeFile(userId, 'project', String(project._id));
  const conversation = await Conversation.create({ userId, title: '引用共享资料', projectId: project._id, messages: [{ id: 'reference', role: 'user', parts: [attachment(file)] }] });
  await assert.rejects(() => deleteProjectDocument({ userId, projectId: String(project._id), fileId: file.fileId }), error => error.status === 409 && /引用共享资料/.test(error.message));
  await assert.rejects(() => catalog.deleteProjectForUser(userId, String(project._id)), error => error.status === 409 && /shared.txt/.test(error.message));
  assert.ok(await WorkspaceProject.exists({ _id: project._id }));
  assert.ok(await StoredFile.exists({ fileId: file.fileId }));
  await updateConversationForUser(String(conversation._id), userId, { deleteMessageId: 'reference' });
  await catalog.deleteProjectForUser(userId, String(project._id));
  assert.equal(await WorkspaceProject.exists({ _id: project._id }), null);
  assert.equal((await Conversation.findById(conversation._id)).projectId, null);
});

test('deleting a conversation protects files linked by another owned conversation', async () => {
  const userId = id(), conversationId = id();
  const file = await makeFile(userId, 'conversation', conversationId);
  await Conversation.create({ _id: conversationId, userId, title: '文件原对话', messages: [{ id: 'original', role: 'user', parts: [attachment(file)] }] });
  await Conversation.create({ userId, title: '保留文件链接', messages: [{ role: 'user', content: `请继续处理 /api/files/${file.fileId}` }] });
  await assert.rejects(() => deleteConversationForUser(conversationId, userId), error => error.status === 409 && /保留文件链接/.test(error.message));
  assert.ok(await Conversation.exists({ _id: conversationId }));
  assert.ok(await StoredFile.exists({ fileId: file.fileId }));
});

test('removing a conversation attachment protects links in other conversations', async () => {
  const userId = id(), conversationId = id();
  const file = await makeFile(userId, 'conversation', conversationId);
  await Conversation.create({ _id: conversationId, userId, title: '附件来源', messages: [{ id: 'original', role: 'user', parts: [attachment(file)] }] });
  await Conversation.create({ userId, title: '保留附件链接', messages: [{ role: 'user', content: `/api/files/${file.fileId}` }] });
  await assert.rejects(() => deleteConversationDocument({ userId, conversationId, fileId: file.fileId }), error => error.status === 409 && /保留附件链接/.test(error.message));
  assert.equal((await Conversation.findById(conversationId)).messages[0].parts.length, 1);
  assert.ok(await StoredFile.exists({ fileId: file.fileId }));
});

test('replacing an imported conversation history preserves externally referenced attachments', async () => {
  const userId = id(), conversationId = id();
  const file = await makeFile(userId, 'conversation', conversationId);
  await Conversation.create({ _id: conversationId, userId, title: '导入历史', messages: [{ id: 'original', role: 'user', parts: [attachment(file)] }] });
  await Conversation.create({ userId, title: '使用导入附件', messages: [{ role: 'user', content: `/api/files/${file.fileId}` }] });
  await assert.rejects(() => updateConversationForUser(conversationId, userId, { messages: [] }), error => error.status === 409 && /使用导入附件/.test(error.message));
  assert.equal((await Conversation.findById(conversationId)).messages.length, 1);
  assert.ok(await StoredFile.exists({ fileId: file.fileId }));
});

test('reenabling a paused backup schedules the next future run without catching up missed runs', async () => {
  const userId = id();
  const schedule = await backups.saveSchedule(userId, { selection: ['settings'], password: 'schedule-password-2026', frequency: 'daily', hour: 2, minute: 30, weekday: 1, enabled: false });
  const now = new Date('2026-10-26T10:00:00Z');
  await BackupSchedule.updateOne({ _id: schedule._id }, { $set: { nextRunAt: new Date('2026-10-20T18:30:00Z') } });
  const resumed = await backups.setScheduleEnabled(userId, String(schedule._id), true, now);
  assert.equal(resumed.enabled, true);
  assert.equal(resumed.nextRunAt.toISOString(), '2026-10-26T18:30:00.000Z');
  await assert.rejects(() => backups.setScheduleEnabled(id(), String(schedule._id), true, now), error => error.status === 404);
});

test('editing and rerunning a message protects discarded task artifacts linked by another conversation', async () => {
  const userId = id(), conversationId = id(), taskId = id();
  const file = await makeFile(userId, 'task', taskId);
  const { saveAdminModelSettings } = await import('../../lib/server/models/service.js');
  const { DEFAULT_MODEL_SETTINGS } = await import('../../lib/server/models/config.js');
  await saveAdminModelSettings({ ...DEFAULT_MODEL_SETTINGS, baseUrl: 'https://fixture.invalid/v1', modelId: 'fixture-model', apiKey: 'test-only-key' }, userId);
  await WorkbenchTask.create({ _id: taskId, userId, conversationId, requestId: id(), fingerprint: 'rerun', userMessageId: 'question', modelMessageId: 'answer', model: 'fixture-model', status: 'completed', artifacts: [{ fileId: file.fileId }] });
  await Conversation.create({ _id: conversationId, userId, title: '重做来源', messages: [{ id: 'question', role: 'user', content: '原请求' }, { id: 'answer', role: 'model', content: '原成果', taskId }] });
  await Conversation.create({ userId, title: '继续使用原成果', messages: [{ role: 'user', parts: [attachment(file)] }] });
  const { createTask } = await import('../../lib/server/workbench/tasks.js');
  await assert.rejects(() => createTask(userId, { conversationId, requestId: randomUUID(), prompt: '修改请求', replaceFromMessageId: 'question' }), error => error.status === 409 && /继续使用原成果/.test(error.message));
  assert.ok(await StoredFile.exists({ fileId: file.fileId }));
  assert.ok(await WorkbenchTask.exists({ _id: taskId }));
  assert.equal((await Conversation.findById(conversationId)).activeTaskId, null);
});

test('user deletion treats waiting approval as an active task and preserves the account', async () => {
  const { default: User } = await import('../../models/User.js');
  const { deleteUserAndData } = await import('../../lib/server/users/deleteUser.js');
  const user = await User.create({ email: 'waiting-approval@example.com', password: 'test-only' });
  await WorkbenchTask.create({ userId: user._id, conversationId: id(), requestId: id(), fingerprint: 'waiting', userMessageId: 'question', modelMessageId: 'answer', model: 'test', status: 'waiting_approval' });
  await assert.rejects(() => deleteUserAndData(String(user._id)), error => error.code === 'USER_ACTIVE_WORKBENCH_TASKS' && error.statusCode === 409);
  const preserved = await User.findById(user._id);
  assert.ok(preserved);
  assert.equal(preserved.deletionInProgress, false);
});

test('a saved model draft without a key rejects new work before creating a conversation or task', async () => {
  const userId = id();
  const { saveAdminModelSettings } = await import('../../lib/server/models/service.js');
  const { DEFAULT_MODEL_SETTINGS } = await import('../../lib/server/models/config.js');
  await saveAdminModelSettings({ ...DEFAULT_MODEL_SETTINGS, baseUrl: 'https://fixture.invalid/v1', modelId: 'draft-model', clearApiKey: true }, userId);
  const { createTask } = await import('../../lib/server/workbench/tasks.js');
  await assert.rejects(() => createTask(userId, { requestId: randomUUID(), prompt: '使用尚未配置的模型' }), error => error.status === 503);
  assert.equal(await WorkbenchTask.countDocuments({ userId }), 0);
  assert.equal(await Conversation.countDocuments({ userId }), 0);
});

test('remote backups require external-tool permission before creating jobs or schedules', async () => {
  const userId = id(), destination = { connectionId: id(), path: 'backups' };
  await assert.rejects(() => backups.createBackup(userId, { selection: ['settings'], password: 'remote-password-2026', destination }), error => error.status === 403 && /外部工具权限/.test(error.message));
  await assert.rejects(() => backups.saveSchedule(userId, { selection: ['settings'], password: 'remote-password-2026', frequency: 'daily', hour: 2, minute: 30, weekday: 1, destination }), error => error.status === 403);
  const { default: BackupJob } = await import('../../models/BackupJob.js');
  assert.equal(await BackupJob.countDocuments({ userId }), 0);
  assert.equal(await BackupSchedule.countDocuments({ userId }), 0);
});

test('scheduled remote backups stop uploading after external-tool permission is turned off', async () => {
  const userId = id(), now = new Date();
  const schedule = await backups.saveSchedule(userId, { selection: ['settings'], password: 'remote-password-2026', frequency: 'daily', hour: 2, minute: 30, weekday: 1 });
  await BackupSchedule.updateOne({ _id: schedule._id }, { $set: { destination: { connectionId: id(), path: 'backups' }, nextRunAt: new Date(now.getTime() - 1000) } });
  await backups.runDueBackups(now);
  assert.match((await BackupSchedule.findById(schedule._id)).lastError, /外部工具权限/);
  const { default: BackupJob } = await import('../../models/BackupJob.js');
  assert.equal(await BackupJob.countDocuments({ userId }), 0);
});

test('revoking external-tool permission aborts an upload already in progress', async t => {
  const userId = id();
  const { default: UserSettings } = await import('../../models/UserSettings.js');
  const { createConnection } = await import('../../lib/server/integrations/connections.js');
  const { updateUserProfileSettings } = await import('../../lib/server/settings/service.js');
  await UserSettings.create({ userId, permissions: { externalTools: true } });
  const connection = await createConnection(userId, { name: 'upload cancellation fixture', kind: 's3', config: { url: 'https://93.184.216.34', root: '' }, credentials: {} });
  let started;
  const uploading = new Promise(resolve => { started = resolve; });
  const spawn = t.mock.method(childProcess, 'spawn', (_command, args, options) => {
    assert.equal(args[0], 'copyto');
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    child.kill = () => { child.emit('close', 1); return true; };
    options.signal.addEventListener('abort', () => { child.emit('error', options.signal.reason); child.emit('close', 1); }, { once: true });
    started(options.signal);
    return child;
  });
  syncBuiltinESMExports();
  try {
    const operation = backups.createBackup(userId, { selection: ['settings'], password: 'remote-password-2026', destination: { connectionId: String(connection._id), path: 'backups' } });
    const rejected = assert.rejects(operation, error => error.status === 403 && /上传已停止/.test(error.message));
    const signal = await uploading;
    await updateUserProfileSettings(userId, { permissions: { externalTools: false } });
    await rejected;
    assert.equal(signal.aborted, true);
    const { default: BackupJob } = await import('../../models/BackupJob.js');
    const job = await BackupJob.findOne({ userId });
    assert.equal(job.status, 'failed');
    assert.match(job.error, /上传已停止/);
  } finally {
    spawn.mock.restore();
    syncBuiltinESMExports();
  }
});
