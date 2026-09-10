import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { zipStream, readZip, assetPath } from '../../lib/server/skills/archive.mjs';
import { encryptBackup, decryptBackup } from '../../lib/server/backups/crypto.mjs';
import { safeSettings, safeConversation, nextScheduleRun, rewriteReferences } from '../../lib/server/backups/snapshot.mjs';

test('ZIP and encrypted backup roundtrip with binary and Unicode assets', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vectaix-roundtrip-'));
  try {
    const encrypted = path.join(directory, 'backup.vxb'), decoded = path.join(directory, 'archive.zip');
    const data = Buffer.from([0,255,16,10]);
    await encryptBackup(zipStream([{ name: 'SKILL.md', buffer: Buffer.from('# 测试技能') }, { name: 'assets/样本.bin', buffer: data }]), encrypted, 'correct-horse-battery');
    assert.ok(!(await readFile(encrypted)).includes(Buffer.from('测试技能')));
    await decryptBackup(encrypted, decoded, 'correct-horse-battery');
    const entries = await readZip(await readFile(decoded));
    assert.equal(entries.get('SKILL.md').toString(), '# 测试技能'); assert.deepEqual(entries.get('assets/样本.bin'), data);
    await assert.rejects(() => decryptBackup(encrypted, path.join(directory, 'wrong.zip'), 'wrong-password'), /密码错误/);
    const changed = await readFile(encrypted); changed[45] ^= 1; await writeFile(path.join(directory, 'tampered.vxb'), changed);
    await assert.rejects(() => decryptBackup(path.join(directory, 'tampered.vxb'), path.join(directory, 'tampered.zip'), 'correct-horse-battery'), /密码错误/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('archive paths and expansion limits reject unsafe entries', async () => {
  for (const name of ['../secret','/root/key','C:/secret','a\\b','a/../b']) assert.throws(() => assetPath(name));
  const chunks = []; for await (const chunk of zipStream([{ name: 'large.txt', buffer: Buffer.alloc(10000) }])) chunks.push(chunk);
  await assert.rejects(() => readZip(Buffer.concat(chunks), { maxBytes: 100 }), /过大/);
});
test('backup excludes credentials, permissions and provider execution state', () => {
  const result = safeSettings({ nickname: '用户', permissions: { browser: true }, providerKey: 'SECRET', assistant: { name: '助手', token: 'SECRET' }, systemPrompts: [{ name: 'a', content: 'b', secret: 'SECRET' }] });
  assert.equal(JSON.stringify(result).includes('SECRET'), false); assert.equal(result.permissions, undefined);
  const conversation = safeConversation({ _id: 'id', messages: [{ role: 'model', content: 'hello', providerState: { secret: 'SECRET' }, tools: [{ cookie: 'SECRET' }] }], browserState: 'SECRET' });
  assert.equal(JSON.stringify(conversation).includes('SECRET'), false);
});
test('daily and weekly schedules use Beijing time; links remap', () => {
  assert.equal(nextScheduleRun({ frequency: 'daily', hour: 2, minute: 0 }, new Date('2026-09-10T00:00:00Z')).toISOString(), '2026-09-10T18:00:00.000Z');
  assert.equal(nextScheduleRun({ frequency: 'weekly', weekday: 0, hour: 2, minute: 0 }, new Date('2026-09-10T00:00:00Z')).toISOString(), '2026-09-12T18:00:00.000Z');
  const id = 'fdf21534-b334-4d0e-b67a-339b80121056'; assert.deepEqual(rewriteReferences({ fileId: id, content: `附件 /api/files/${id}` }, new Map([[id,'new-id']])), { fileId: 'new-id', content: '附件 /api/files/new-id' });
});

test('disk extraction streams entries and rejects archive traversal and expansion', async () => {
  const { extractZipFile } = await import('../../lib/server/skills/archive.mjs');
  const { pipeline } = await import('node:stream/promises'); const { createWriteStream } = await import('node:fs');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vectaix-disk-zip-'));
  try {
    const archive = path.join(directory, 'source.zip'); await pipeline(zipStream([{ name: 'safe/x', buffer: Buffer.alloc(1024*1024, 42) }]), createWriteStream(archive));
    const entries = await extractZipFile(archive, path.join(directory, 'output')); const file = entries.get('safe/x'); assert.equal(file.size, 1024*1024); assert.equal((await readFile(file.path))[1000], 42); assert.equal(file.buffer, undefined);
    await assert.rejects(() => extractZipFile(archive, path.join(directory, 'too-large'), { maxBytes: 100 }), /大小限制/);
    const raw = await readFile(archive); let offset = 0; while ((offset = raw.indexOf(Buffer.from('safe/x'), offset)) !== -1) { raw.write('../bad', offset); offset += 6; } await writeFile(path.join(directory, 'bad.zip'), raw);
    await assert.rejects(() => extractZipFile(path.join(directory, 'bad.zip'), path.join(directory, 'unsafe')), /invalid relative path|非法文件路径/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('partial selections reject missing project and file dependencies without expanding memory scope', async () => {
  const { validateDependencies } = await import('../../lib/server/backups/snapshot.mjs');
  const manifest = { selection: ['memories'], projects: [], conversations: [], files: [], skills: [], documents: [], settings: null, memories: [{ scope: 'project', projectId: 'abc' }] };
  assert.throws(() => validateDependencies(manifest), /同时选择/);
  assert.equal(manifest.memories[0].scope, 'project');
  manifest.memories = [{ scope: 'personal', projectId: null, content: '参考 /api/files/fdf21534-b334-4d0e-b67a-339b80121056' }]; assert.throws(() => validateDependencies(manifest), /文件/);
  manifest.memories = [{ scope: 'project', projectId: null }]; assert.throws(() => validateDependencies(manifest), /范围/);
});
