import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.MONGO_URI = 'mongodb://127.0.0.1/test';
const { normalizeSkillSource, validateSkillSlug, runSkillsCli, readInstalledSkills, withSkillOperation } = await import('../../lib/server/skills/cli.js');

test('skill sources exclude credentials, local files and command flags', () => {
  assert.equal(normalizeSkillSource('Vercel-Labs/skills'), 'https://github.com/vercel-labs/skills');
  assert.equal(normalizeSkillSource('https://github.com/vercel-labs/skills.git'), 'https://github.com/vercel-labs/skills');
  assert.equal(normalizeSkillSource('https://github.com/vercel-labs/skills/tree/main/skills/find-skills'), 'https://github.com/vercel-labs/skills/tree/main/skills/find-skills');
  for (const source of ['--help', 'file:///etc/passwd', '/tmp/skills', 'https://gitlab.com/example/skills', 'https://token@github.com/example/skills', 'https://github.com/example/skills?token=x', 'https://github.com/example/skills/tree/main/%2e%2e/private']) {
    assert.throws(() => normalizeSkillSource(source));
  }
  for (const name of ['../escape', '--all', 'a b', 'demo;echo bad', 'x/y']) assert.throws(() => validateSkillSlug(name));
});

test('real Skills CLI installs and removes only within its managed workspace', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'huajuan-skills-cli-'));
  try {
    const fixture = path.join(directory, 'source'), workspace = path.join(directory, 'workspace');
    await mkdir(fixture);
    await writeFile(path.join(fixture, 'SKILL.md'), '---\nname: huajuan-test-skill\ndescription: Verify managed skill installation\n---\nRead the supplied document.');
    await writeFile(path.join(fixture, 'reference.txt'), '共享参考资料');
    assert.match(await runSkillsCli(['--version'], workspace), /1\.7\.4/);
    await runSkillsCli(['add', fixture, '--agent', 'codex', '--skill', 'huajuan-test-skill', '--yes', '--copy'], workspace);
    const installed = await readInstalledSkills(workspace);
    assert.equal(installed.length, 1);
    assert.equal(installed[0].slug, 'huajuan-test-skill');
    assert.equal(installed[0].files.get('reference.txt').toString(), '共享参考资料');
    const output = await runSkillsCli(['list', '--agent', 'codex', '--json'], workspace);
    assert.match(output, /huajuan-test-skill/);
    await runSkillsCli(['remove', 'huajuan-test-skill', '--yes'], workspace);
    assert.deepEqual(await readInstalledSkills(workspace), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('installed skill scanning rejects directory symlinks before loading content', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'huajuan-skill-path-'));
  try {
    const installed = path.join(directory, '.agents', 'skills');
    const outside = path.join(directory, 'outside');
    await mkdir(installed, { recursive: true }); await mkdir(outside);
    await symlink(outside, path.join(installed, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(() => readInstalledSkills(directory), /异常文件或链接/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('database operation lease serializes administrator skill changes', async () => {
  const database = await MongoMemoryServer.create();
  try {
    await mongoose.connect(database.getUri());
    let release, started;
    const entered = new Promise(resolve => { started = resolve; });
    const first = withSkillOperation(async () => { started(); await new Promise(resolve => { release = resolve; }); return 'saved'; });
    await entered;
    await assert.rejects(() => withSkillOperation(async () => 'duplicate'), /另一个技能操作/);
    release(); assert.equal(await first, 'saved');
    assert.equal(await withSkillOperation(async () => 'next'), 'next');
  } finally { await mongoose.disconnect(); await database.stop(); }
});

test('global skill migration removes personal records and obsolete unique indexes', async () => {
  const database = await MongoMemoryServer.create();
  try {
    await mongoose.connect(database.getUri());
    const { default: WorkbenchSkill } = await import('../../models/WorkbenchSkill.js');
    const { default: SkillAsset } = await import('../../models/SkillAsset.js');
    const { migrateGlobalSkills } = await import('../../lib/server/skills/service.js');
    const userId = new mongoose.Types.ObjectId(), personalId = new mongoose.Types.ObjectId();
    await WorkbenchSkill.collection.insertOne({ _id: personalId, userId, builtinKey: 'research', name: '个人技能' });
    await SkillAsset.collection.insertOne({ userId, skillId: personalId, path: 'old.txt', data: Buffer.from('old') });
    await WorkbenchSkill.collection.createIndex({ userId: 1, builtinKey: 1 }, { unique: true, partialFilterExpression: { builtinKey: { $type: 'string' } } });
    await SkillAsset.collection.createIndex({ userId: 1, skillId: 1, path: 1 }, { unique: true });
    const managed = await WorkbenchSkill.create({ managed: true, slug: 'shared', name: 'shared', description: '共享技能', content: 'instructions', revision: 'revision-one', source: { type: 'github', url: 'https://github.com/example/skills' } });
    await migrateGlobalSkills();
    assert.equal(await WorkbenchSkill.countDocuments(), 1);
    assert.ok(await WorkbenchSkill.exists({ _id: managed._id }));
    assert.equal(await SkillAsset.countDocuments(), 0);
    assert.equal((await WorkbenchSkill.collection.indexes()).some(index => index.name === 'userId_1_builtinKey_1'), false);
    assert.equal((await SkillAsset.collection.indexes()).some(index => index.name === 'userId_1_skillId_1_path_1'), false);
    assert.ok((await SkillAsset.collection.indexes()).some(index => index.name === 'skillId_1_revision_1_path_1'));
    await migrateGlobalSkills();
    assert.equal(await WorkbenchSkill.countDocuments(), 1);
  } finally { await mongoose.disconnect(); await database.stop(); }
});
