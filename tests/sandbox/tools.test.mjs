import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const directory = await mkdtemp(path.join(os.tmpdir(), 'huajuan-sandbox-tools-'));
const mongo = await MongoMemoryServer.create();
process.env.MONGO_URI = mongo.getUri();
process.env.STORAGE_ROOT = directory;
process.env.APP_SECRETS_KEY = Buffer.alloc(32, 6).toString('base64');
const { registerSandboxTools } = await import('../../lib/server/sandbox/tools.js');
const { encryptSecret } = await import('../../lib/server/security/secrets.mjs');
const { createStoredFile, readStoredFileBuffer } = await import('../../lib/server/storage/service.js');
const { readProjectDocument } = await import('../../lib/server/workbench/documents.js');
const { publishInstalledSkills } = await import('../../lib/server/skills/service.js');
const { default: PlatformSettings } = await import('../../models/PlatformSettings.js');
const { default: WorkbenchTask } = await import('../../models/WorkbenchTask.js');
const { default: WorkbenchSkill } = await import('../../models/WorkbenchSkill.js');
const { default: Conversation } = await import('../../models/Conversation.js');
const { default: StoredFile } = await import('../../models/StoredFile.js');
await mongoose.connect(mongo.getUri());
global.mongoose.conn = mongoose;
test.after(async () => { await mongoose.disconnect(); await mongo.stop(); await rm(directory, { recursive: true, force: true }); });

async function taskFixture() {
  const userId = new mongoose.Types.ObjectId();
  const conversation = await Conversation.create({ userId, title: '沙盒任务' });
  return WorkbenchTask.create({ userId, conversationId: conversation._id, requestId: crypto.randomUUID(), fingerprint: 'sandbox', userMessageId: 'u', modelMessageId: 'm', model: 'test-model', status: 'running' });
}

function sessionFixture() {
  const files = new Map();
  let closed = 0;
  return {
    files, get closed() { return closed; },
    writeFiles: async entries => { for (const file of entries) files.set(file.path, Buffer.from(file.data)); },
    statFile: async filePath => ({ size: files.get(filePath).length, type: 'file' }),
    readFile: async filePath => files.get(filePath),
    close: async () => { closed++; },
  };
}

test('disabled sandbox leaves tools unavailable and does not create a session', async () => {
  await PlatformSettings.updateOne({ _id: 'platform' }, { $set: { sandboxConfig: { enabled: false } } }, { upsert: true });
  const tools = [];
  const cleanup = await registerSandboxTools({ registry: { add: value => tools.push(value) }, task: await taskFixture(), assertActive: async () => {} }, { createSession: () => { assert.fail('disabled sandbox created a session'); } });
  await cleanup();
  assert.equal(tools.length, 0);
});

test('Python steps reuse task files and publish a readable result to the conversation', async () => {
  await PlatformSettings.updateOne({ _id: 'platform' }, { $set: { sandboxConfig: { enabled: true, environmentId: '11111111-2222-4333-8444-555555555555', timeoutSeconds: 120, cpu: 1, memoryGB: 1, setupCommand: '', encryptedApiKey: encryptSecret('fixture-secret', 'platform:sandbox') } } });
  const task = await taskFixture();
  const source = await createStoredFile({ userId: String(task.userId), input: Buffer.from('value\n2\n3\n'), originalName: 'data.csv', extension: 'csv', mimeType: 'text/csv', category: 'document', kind: 'chat', ownerType: 'conversation', ownerId: String(task.conversationId) });
  const sandbox = sessionFixture(), tools = new Map();
  let created = 0, steps = 0;
  sandbox.runPython = async () => {
    steps++;
    assert.match(sandbox.files.get('/home/user/work/data.csv').toString(), /2\n3/);
    if (steps === 1) {
      sandbox.files.set('/home/user/work/total.json', Buffer.from('{"total":5}'));
      return { stdout: '5\n', stderr: '', exitCode: 0 };
    }
    assert.equal(JSON.parse(sandbox.files.get('/home/user/work/total.json')).total, 5);
    sandbox.files.set('/home/user/work/result.txt', Buffer.from('总计：5'));
    return { stdout: 'saved\n', stderr: '', exitCode: 0 };
  };
  const cleanup = await registerSandboxTools({ registry: { add: item => tools.set(item.definition.name, item) }, task, assertActive: async () => {} }, { createSession: async () => { created++; return sandbox; } });
  assert.equal(created, 0);
  try {
    const first = await tools.get('run_python').execute({ code: 'calculate', files: [{ fileId: source.fileId, path: 'data.csv' }], outputs: [] });
    assert.equal(first.stdout, '5\n');
    const result = await tools.get('run_python').execute({ code: 'export', files: [], outputs: ['result.txt'] });
    assert.equal(created, 1);
    assert.equal(result.files[0].name, 'result.txt');
    const saved = await StoredFile.findOne({ fileId: result.files[0].fileId });
    assert.equal((await readStoredFileBuffer(saved)).toString(), '总计：5');
    assert.equal((await WorkbenchTask.findById(task._id)).artifacts[0].fileId, saved.fileId);
    const readable = await readProjectDocument({ userId: String(task.userId), conversationId: String(task.conversationId), fileId: saved.fileId });
    assert.match(JSON.stringify(readable.chunks), /总计：5/);
  } finally { await cleanup(); }
  assert.equal(sandbox.closed, 1);
});

test('skill scripts receive their full package and report failures before a corrected run', async () => {
  const task = await taskFixture();
  await publishInstalledSkills('https://github.com/example/sandbox-fixture', [{ slug: 'report-fixture', files: new Map([
    ['SKILL.md', Buffer.from('---\nname: Report fixture\ndescription: Build a report\n---\nRead data and run scripts/report.py.')],
    ['scripts/report.py', Buffer.from('print("report")')], ['data/reference.txt', Buffer.from('reference material')],
  ]) }]);
  const skill = await WorkbenchSkill.findOne({ slug: 'report-fixture' });
  const sandbox = sessionFixture(), tools = new Map();
  let runs = 0;
  sandbox.runScript = async ({ path: scriptPath, args, cwd }) => {
    runs++;
    assert.equal(scriptPath, `${cwd}/scripts/report.py`);
    assert.equal(sandbox.files.get(`${cwd}/data/reference.txt`).toString(), 'reference material');
    assert.match(sandbox.files.get(`${cwd}/SKILL.md`).toString(), /Build a report/);
    assert.deepEqual(args, ['--title', "User's report"]);
    if (runs === 1) return { stdout: '', stderr: 'Please correct the title format', exitCode: 1 };
    sandbox.files.set('/home/user/work/report.txt', Buffer.from("User's report"));
    return { stdout: 'done', stderr: '', exitCode: 0 };
  };
  const cleanup = await registerSandboxTools({ registry: { add: item => tools.set(item.definition.name, item) }, task, assertActive: async () => {} }, { createSession: async () => sandbox });
  const args = { skillId: String(skill._id), path: 'scripts/report.py', args: ['--title', "User's report"], files: [], outputs: ['report.txt'] };
  try {
    const failed = await tools.get('run_skill_script').execute(args);
    assert.equal(failed.exitCode, 1);
    assert.match(failed.stderr, /correct the title/);
    assert.deepEqual(failed.files, []);
    const corrected = await tools.get('run_skill_script').execute(args);
    assert.equal(corrected.files[0].name, 'report.txt');
    assert.equal((await WorkbenchTask.findById(task._id)).artifacts.length, 1);
  } finally { await cleanup(); }
  assert.equal(sandbox.closed, 1);
});
