import path from 'node:path';
import YAML from 'yaml';
import WorkbenchSkill from '@/models/WorkbenchSkill';
import Conversation from '@/models/Conversation';
import SkillAsset from '@/models/SkillAsset';
import { requireObjectId, workbenchError } from '@/lib/server/workbench/apiHelpers';
import { inspectUploadedFile } from '@/lib/server/storage/fileInspection';
import { assertPublicUrl } from '@/lib/server/security/publicUrl.mjs';
import { readZip, assetPath, zipStream } from './archive.mjs';

const SCRIPT = /\.(?:sh|bash|py|js|mjs|cjs|ts|ps1|bat|exe|wasm)$/i;
export function parseSkill(content) {
  if (typeof content !== 'string' || !content.trim() || content.length > 200000) throw workbenchError('技能内容不能为空，且不能超过 20 万字');
  let metadata = {};
  if (content.startsWith('---\n') || content.startsWith('---\r\n')) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
    if (!match) throw workbenchError('技能头部格式不完整');
    metadata = YAML.parse(match[1], { maxAliasCount: 20 });
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw workbenchError('技能头部必须是名称与属性');
  }
  const name = typeof metadata.name === 'string' ? metadata.name : /^#\s+(.+)$/m.exec(content)?.[1];
  if (!name?.trim() || name.length > 100) throw workbenchError('请在文件头部提供 name 或一级标题，最多 100 字');
  const description = typeof metadata.description === 'string' ? metadata.description : '';
  if (description.length > 2000) throw workbenchError('技能介绍最多 2000 字');
  return { name: name.trim(), description, content, metadata };
}
export async function requireSkill(userId, id) {
  requireObjectId(id); const skill = await WorkbenchSkill.findOne({ _id: id, userId });
  if (!skill) throw workbenchError('技能不存在', 404); return skill;
}
export async function skillAssets(userId, id) {
  await requireSkill(userId, id);
  return SkillAsset.find({ userId, skillId: id }).select('-data').sort({ path: 1 }).lean();
}
export async function readSkillAsset(userId, id, requestedPath) {
  await requireSkill(userId, id); assetPath(requestedPath);
  const asset = await SkillAsset.findOne({ userId, skillId: id, path: requestedPath });
  if (!asset) throw workbenchError('技能附件不存在', 404); return asset;
}
async function githubFiles(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || parsed.username || parsed.password) throw workbenchError('只支持公开 GitHub 仓库链接');
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length < 2 || !parts.slice(0,2).every(p => /^[\w.-]+$/.test(p))) throw workbenchError('GitHub 仓库地址无效');
  let ref, directory = '';
  if (parts.length > 2) { if (parts[2] !== 'tree' || !parts[3]) throw workbenchError('请使用仓库或 tree 分支目录链接'); ref = parts[3]; directory = parts.slice(4).join('/'); }
  const get = async value => {
    await assertPublicUrl(value); const response = await fetch(value, { redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Accept: 'application/vnd.github+json' } });
    if (!response.ok) throw workbenchError(`GitHub 读取失败（${response.status}）`);
    return response;
  };
  if (!ref) { const info = await (await get(`https://api.github.com/repos/${parts[0]}/${parts[1]}`)).json(); ref = info.default_branch; }
  const response = await get(`https://api.github.com/repos/${parts[0]}/${parts[1]}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
  const tree = await response.json();
  if (tree.truncated) throw workbenchError('仓库过大，请导入单独技能压缩包');
  const prefix = directory ? `${directory}/` : '';
  const entries = tree.tree.filter(e => e.type === 'blob' && e.path.startsWith(prefix));
  if (entries.length > 500 || entries.reduce((sum, e) => sum + e.size, 0) > 50*1024*1024) throw workbenchError('技能目录超过 500 个文件或 50 MB');
  const files = new Map();
  for (const entry of entries) {
    if (entry.mode === '120000') throw workbenchError('技能不支持符号链接');
    const file = await (await get(`https://api.github.com/repos/${parts[0]}/${parts[1]}/git/blobs/${entry.sha}`)).json();
    files.set(assetPath(entry.path.slice(prefix.length)), Buffer.from(file.content, 'base64'));
  }
  return { files, source: { type: 'github', url, ref, directory, importedAt: new Date() } };
}
export async function importSkill(userId, { name, buffer, githubUrl, replaceId }) {
  let files, source;
  if (githubUrl) ({ files, source } = await githubFiles(githubUrl));
  else {
    if (!Buffer.isBuffer(buffer) || buffer.length > 50*1024*1024) throw workbenchError('技能文件最大 50 MB');
    if (/\.(zip|skill)$/i.test(name)) files = await readZip(buffer, { maxBytes: 50*1024*1024, maxEntries: 500 });
    else if (/\.md$/i.test(name)) files = new Map([['SKILL.md', buffer]]);
    else throw workbenchError('支持 .md、.zip 和 .skill 文件');
    source = { type: 'file', importedAt: new Date() };
  }
  const mains = [...files.keys()].filter(p => path.posix.basename(p) === 'SKILL.md');
  if (mains.length !== 1) throw workbenchError('技能包必须包含且仅包含一个 SKILL.md');
  const main = mains[0], prefix = main.slice(0, -8), parsed = parseSkill(files.get(main).toString('utf8'));
  const assets = [...files].filter(([p]) => p !== main && p.startsWith(prefix)).map(([p, data]) => ({ path: assetPath(p.slice(prefix.length)), data, size: data.length, executable: SCRIPT.test(p) }));
  if (assets.some(asset => asset.size > 8*1024*1024)) throw workbenchError('技能单个附件不能超过 8 MB');
  let skill;
  if (replaceId) {
    skill = await requireSkill(userId, replaceId);
    skill.set({ ...parsed, source }); await skill.save();
    await SkillAsset.deleteMany({ userId, skillId: skill._id });
  } else skill = await WorkbenchSkill.create({ userId, ...parsed, source });
  if (assets.length) await SkillAsset.insertMany(assets.map(a => ({ ...a, userId, skillId: skill._id })));
  return skill;
}
export async function exportSkill(userId, id) {
  const skill = await requireSkill(userId, id);
  const assets = await SkillAsset.find({ userId, skillId: id });
  const markdown = /^---\r?\n/.test(skill.content) ? skill.content : `---\n${YAML.stringify({ ...skill.metadata, name: skill.name, description: skill.description })}---\n${skill.content}`;
  return zipStream([{ name: 'SKILL.md', buffer: Buffer.from(markdown) }, ...assets.map(a => ({ name: a.path, buffer: Buffer.from(a.data) }))]);
}
export async function deleteSkill(userId, id) {
  const skill = await requireSkill(userId, id); await SkillAsset.deleteMany({ userId, skillId: id }); await skill.deleteOne(); await Conversation.updateMany({ userId, 'settings.disabledSkillIds': id }, { $pull: { 'settings.disabledSkillIds': id } });
}
export function createSkillToolHandlers({ userId, enabledSkillIds }) {
  const allow = async id => { if (!enabledSkillIds.map(String).includes(String(id))) throw workbenchError('该技能未在当前对话启用', 403); const skill = await requireSkill(userId, id); if (!skill.enabled) throw workbenchError('技能已停用', 403); return skill; };
  return {
    load_skill: async ({ skillId }) => { const skill = await allow(skillId); return { name: skill.name, content: skill.content, assets: await skillAssets(userId, skillId), limitation: '脚本只保存和展示，不会执行。' }; },
    read_skill_file: async ({ skillId, path: requestedPath }) => {
      await allow(skillId); const asset = await readSkillAsset(userId, skillId, requestedPath), buffer = Buffer.from(asset.data), extension = path.extname(requestedPath).slice(1).toLowerCase();
      if (['png','jpg','jpeg','webp','gif'].includes(extension)) { const inspected = inspectUploadedFile(buffer, extension); if (!inspected || inspected.category !== 'image') throw workbenchError('图片内容与扩展名不匹配'); return { kind: 'image', mimeType: inspected.mimeType, data: buffer.toString('base64'), path: requestedPath }; }
      if (/^(md|txt|json|yaml|yml|csv|xml|html|css|js|ts|py|sh|mjs|cjs|bash|ps1|svg)$/.test(extension)) {
        if (asset.size > 200000) throw workbenchError('文本附件过大，请下载查看');
        let content; try { content = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { throw workbenchError('文本附件必须使用 UTF-8 编码'); }
        return { kind: 'text', path: requestedPath, content, executable: false };
      }
      return { kind: 'binary', path: requestedPath, size: asset.size, readable: false, downloadUrl: `/api/skills/${skillId}/assets?path=${encodeURIComponent(requestedPath)}` };
    },
  };
}
