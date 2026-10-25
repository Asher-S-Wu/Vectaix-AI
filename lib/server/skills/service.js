import path from 'node:path';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import YAML from 'yaml';
import WorkbenchSkill from '@/models/WorkbenchSkill';
import SkillAsset from '@/models/SkillAsset';
import { requireObjectId, workbenchError } from '@/lib/server/workbench/apiHelpers';
import { inspectUploadedFile } from '@/lib/server/storage/fileInspection';
import { assetPath } from './archive.mjs';
import { normalizeSkillSource, validateSkillSlug, skillWorkspace, withSkillOperation, runSkillsCli, readInstalledSkills, SKILLS_CLI_VERSION } from './cli';

const SCRIPT = /\.(?:sh|bash|py|js|mjs|cjs|ts|ps1|bat|exe|wasm)$/i;
export async function migrateGlobalSkills() {
  for (const [Model, oldIndex] of [[WorkbenchSkill, 'userId_1_builtinKey_1'], [SkillAsset, 'userId_1_skillId_1_path_1']]) {
    await Model.createCollection();
    const indexes = await Model.collection.indexes();
    if (indexes.some(index => index.name === oldIndex)) await Model.collection.dropIndex(oldIndex);
  }
  await WorkbenchSkill.deleteMany({ managed: { $ne: true } });
  await SkillAsset.deleteMany({ revision: { $exists: false } });
  await WorkbenchSkill.createIndexes();
  await SkillAsset.createIndexes();
}

export function parseSkill(content) {
  if (typeof content !== 'string' || !content.trim() || content.length > 200000) throw workbenchError('技能内容不能为空，且最多 20 万字');
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) throw workbenchError('技能缺少完整的 YAML 文件头');
  const metadata = YAML.parse(match[1], { maxAliasCount: 20 });
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw workbenchError('技能文件头必须包含名称与介绍');
  const { name, description } = metadata;
  if (typeof name !== 'string' || !name.trim() || name.length > 100) throw workbenchError('技能名称最多 100 字');
  if (typeof description !== 'string' || !description.trim() || description.length > 2000) throw workbenchError('技能介绍最多 2000 字');
  return { name: name.trim(), description: description.trim(), content, metadata };
}

export function listEnabledSkills() {
  return WorkbenchSkill.find({ managed: true, enabled: true }).select('-content -metadata -revision').sort({ name: 1 }).lean();
}

export async function listManagedSkills() {
  return { skills: await WorkbenchSkill.find({ managed: true }).select('-content -metadata -revision').sort({ name: 1 }).lean(), cli: { name: 'Skills CLI', version: SKILLS_CLI_VERSION } };
}

export async function requireSkill(id) {
  requireObjectId(id);
  const skill = await WorkbenchSkill.findOne({ _id: id, managed: true });
  if (!skill) throw workbenchError('技能不存在', 404);
  return skill;
}

export async function skillAssets(id) {
  const skill = await requireSkill(id);
  return SkillAsset.find({ skillId: id, revision: skill.revision }).select('path size executable').sort({ path: 1 }).lean();
}

export async function readSkillAsset(id, requestedPath) {
  const skill = await requireSkill(id);
  assetPath(requestedPath);
  const asset = await SkillAsset.findOne({ skillId: id, revision: skill.revision, path: requestedPath });
  if (!asset) throw workbenchError('技能附件不存在', 404);
  return asset;
}

export async function publishInstalledSkills(source, installed) {
  source = normalizeSkillSource(source);
  const prepared = installed.map(({ slug, files }) => ({ slug: validateSkillSlug(slug), files, parsed: parseSkill(files.get('SKILL.md')?.toString('utf8')) }));
  if (!prepared.length) throw workbenchError('仓库中没有找到可安装的技能');
  const conflicts = await WorkbenchSkill.find({ managed: true, slug: { $in: prepared.map(item => item.slug) }, 'source.url': { $ne: source } }).select('name').lean();
  if (conflicts.length) throw workbenchError(`已安装其他来源的同名技能：${conflicts.map(item => item.name).join('、')}。请先移除同名技能`, 409);
  for (const { slug, files, parsed } of prepared) {
    const existing = await WorkbenchSkill.findOne({ managed: true, slug });
    const skillId = existing?._id || new mongoose.Types.ObjectId(), revision = crypto.randomUUID();
    const assets = [...files].filter(([name]) => name !== 'SKILL.md').map(([name, data]) => ({ skillId, revision, path: assetPath(name), data, size: data.length, executable: SCRIPT.test(name) }));
    try {
      if (assets.length) await SkillAsset.insertMany(assets);
      await WorkbenchSkill.updateOne({ _id: skillId }, { $set: { ...parsed, slug, managed: true, revision, source: { type: 'github', url: source, importedAt: new Date() } }, $setOnInsert: { enabled: true } }, { upsert: true, runValidators: true });
    } catch (error) {
      await SkillAsset.deleteMany({ skillId, revision });
      throw error;
    }
    await SkillAsset.deleteMany({ skillId, revision: { $ne: revision } });
  }
  return listManagedSkills();
}

export async function installManagedSkills({ source, skill }) {
  source = normalizeSkillSource(source);
  if (skill !== undefined && skill !== '') validateSkillSlug(skill);
  return withSkillOperation(async () => {
    const workspace = skillWorkspace(source);
    const output = await runSkillsCli(['add', source, '--agent', 'codex', '--skill', skill || '*', '--yes', '--copy'], workspace);
    const installed = await readInstalledSkills(workspace);
    const selected = skill ? installed.filter(item => item.slug === skill) : installed;
    if (skill && !selected.length) throw workbenchError('Skills CLI 未安装指定技能，请核对技能名称');
    return { ...await publishInstalledSkills(source, selected), output };
  });
}

export async function updateManagedSkill(id) {
  return withSkillOperation(async () => {
    const skill = await requireSkill(id), workspace = skillWorkspace(skill.source.url);
    const output = await runSkillsCli(['update', skill.slug, '--project', '--yes'], workspace);
    const selected = (await readInstalledSkills(workspace)).filter(item => item.slug === skill.slug);
    if (!selected.length) throw workbenchError('技能安装目录缺失，请从原仓库重新安装');
    return { ...await publishInstalledSkills(skill.source.url, selected), output };
  });
}

export async function setManagedSkillEnabled(id, enabled) {
  if (typeof enabled !== 'boolean') throw workbenchError('请选择技能启用状态');
  return withSkillOperation(async () => {
    const skill = await requireSkill(id);
    skill.enabled = enabled;
    await skill.save();
    return { skill: (await listManagedSkills()).skills.find(item => String(item._id) === String(id)) };
  });
}

export async function deleteManagedSkill(id) {
  return withSkillOperation(async () => {
    const skill = await requireSkill(id);
    const output = await runSkillsCli(['remove', skill.slug, '--yes'], skillWorkspace(skill.source.url));
    await skill.deleteOne();
    await SkillAsset.deleteMany({ skillId: id });
    return { ok: true, output };
  });
}

export function createSkillToolHandlers({ enabledSkillIds }) {
  const allow = async id => {
    if (!enabledSkillIds.map(String).includes(String(id))) throw workbenchError('该技能尚未由管理员启用', 403);
    const skill = await requireSkill(id);
    if (!skill.enabled) throw workbenchError('管理员已停用此技能', 403);
    return skill;
  };
  return {
    load_skill: async ({ skillId }) => {
      const skill = await allow(skillId);
      return { name: skill.name, content: skill.content, assets: await skillAssets(skillId) };
    },
    read_skill_file: async ({ skillId, path: requestedPath }) => {
      await allow(skillId);
      const asset = await readSkillAsset(skillId, requestedPath), buffer = Buffer.from(asset.data), extension = path.extname(requestedPath).slice(1).toLowerCase();
      if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension)) {
        const inspected = inspectUploadedFile(buffer, extension);
        if (!inspected || inspected.category !== 'image') throw workbenchError('图片内容与扩展名不匹配');
        return { kind: 'image', mimeType: inspected.mimeType, data: buffer.toString('base64'), path: requestedPath };
      }
      if (/^(md|txt|json|yaml|yml|csv|xml|html|css|js|ts|py|sh|mjs|cjs|bash|ps1|svg)$/.test(extension)) {
        if (asset.size > 200000) throw workbenchError('文本附件超过 20 万字节，请使用较小的参考文件');
        let content;
        try { content = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { throw workbenchError('文本附件必须使用 UTF-8 编码'); }
        return { kind: 'text', path: requestedPath, content, executable: false };
      }
      return { kind: 'binary', path: requestedPath, size: asset.size, readable: false };
    },
  };
}
