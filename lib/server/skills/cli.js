import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readdir, lstat, readFile, realpath } from 'node:fs/promises';
import mongoose from 'mongoose';
import { getStorageRoot } from '@/lib/server/storage/config';
import { workbenchError } from '@/lib/server/workbench/apiHelpers';
import { assetPath } from './archive.mjs';

const executeFile = promisify(execFile);
export const SKILLS_CLI_VERSION = '1.7.4';
const MAX_BYTES = 50 * 1024 * 1024;

export function normalizeSkillSource(value) {
  if (typeof value !== 'string' || value.length > 500) throw workbenchError('请填写公开 GitHub 仓库地址');
  let source = value.trim();
  if (/[\\%]/.test(source) || source.split('/').some(part => part === '.' || part === '..')) throw workbenchError('仓库地址包含无效路径');
  if (/^[a-zA-Z0-9][\w.-]*\/[a-zA-Z0-9][\w.-]*$/.test(source)) source = `https://github.com/${source}`;
  let url;
  try { url = new URL(source); } catch { throw workbenchError('请填写 owner/repo 或公开 GitHub 仓库地址'); }
  const parts = url.pathname.replace(/\/$/, '').split('/').slice(1);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash || parts.length < 2 || parts.some(part => !/^[a-zA-Z0-9][\w.-]*$/.test(part)) || (parts.length > 2 && (parts[2] !== 'tree' || parts.length < 4))) {
    throw workbenchError('请使用公开 GitHub 仓库或 tree 目录地址');
  }
  parts[0] = parts[0].toLowerCase(); parts[1] = parts[1].replace(/\.git$/, '').toLowerCase();
  return `https://github.com/${parts.join('/')}`;
}

export function validateSkillSlug(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value)) throw workbenchError('技能名称仅使用字母、数字、点、短横线和下划线');
  return value;
}

export function skillWorkspace(source) {
  return path.join(getStorageRoot(), 'skills', crypto.createHash('sha256').update(normalizeSkillSource(source)).digest('hex'));
}

export async function withSkillOperation(action) {
  const collection = mongoose.connection.collection('platform_operation_locks');
  const token = crypto.randomUUID(), now = new Date();
  try {
    await collection.findOneAndUpdate({ _id: 'skills', expiresAt: { $lte: now } }, { $set: { token, expiresAt: new Date(now.getTime() + 300000) } }, { upsert: true });
  } catch (error) {
    if (error.code === 11000) throw workbenchError('另一个技能操作正在进行，请完成后再操作', 409);
    throw error;
  }
  try { return await action(); }
  finally { await collection.deleteOne({ _id: 'skills', token }); }
}

export async function runSkillsCli(args, workspace) {
  await mkdir(workspace, { recursive: true });
  const entry = path.join(process.cwd(), 'node_modules', 'skills', 'bin', 'cli.mjs');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|SystemRoot|ComSpec|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|HTTPS_PROXY|HTTP_PROXY|NO_PROXY|SSL_CERT_FILE|SSL_CERT_DIR)$/i.test(key)));
  Object.assign(env, { CI: '1', NO_COLOR: '1', DISABLE_TELEMETRY: '1', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' });
  try {
    const { stdout, stderr } = await executeFile(process.execPath, [entry, ...args], { cwd: workspace, env, shell: false, windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 });
    return `${stdout}\n${stderr}`.trim().replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').slice(-16000);
  } catch (error) {
    if (error.killed || error.code === 'ETIMEDOUT') throw workbenchError('Skills CLI 执行超过 2 分钟，请检查仓库连接后重试', 504);
    console.error('[Skills CLI] Command failed', { command: args[0], code: error.code });
    throw workbenchError('Skills CLI 操作失败，请检查仓库地址、技能名称和服务器的 Git 配置', 502);
  }
}

export async function readInstalledSkills(workspace) {
  const root = path.join(workspace, '.agents', 'skills');
  let canonicalRoot;
  try { canonicalRoot = await realpath(root); }
  catch (error) { if (error.code === 'ENOENT') throw workbenchError('技能安装目录缺失，请检查源仓库和技能名称'); throw error; }
  const relativeRoot = path.relative(await realpath(workspace), canonicalRoot);
  if (relativeRoot.startsWith('..') || path.isAbsolute(relativeRoot)) throw workbenchError('技能目录超出专用工作空间');
  const folders = await readdir(root, { withFileTypes: true });
  const skills = [];
  let bytes = 0, count = 0;
  for (const folder of folders) {
    if (!folder.isDirectory() || folder.isSymbolicLink()) throw workbenchError('技能安装目录包含异常文件或链接');
    const slug = validateSkillSlug(folder.name), files = new Map();
    const walk = async (directory, prefix = '') => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (++count > 1000) throw workbenchError('技能包最多包含 1000 个文件和目录');
        const relative = assetPath(`${prefix}${entry.name}`), absolute = path.join(directory, entry.name);
        const info = await lstat(absolute);
        if (info.isSymbolicLink()) throw workbenchError('技能文件应使用实际文件，请移除符号链接');
        const resolved = await realpath(absolute);
        const within = path.relative(canonicalRoot, resolved);
        if (within.startsWith('..') || path.isAbsolute(within)) throw workbenchError('技能文件超出安装目录');
        if (info.isDirectory()) { await walk(absolute, `${relative}/`); continue; }
        if (!info.isFile() || info.size > 8 * 1024 * 1024 || (bytes += info.size) > MAX_BYTES) throw workbenchError('技能包总计最多 50 MB，单个附件最多 8 MB');
        files.set(relative, await readFile(absolute));
      }
    };
    await walk(path.join(root, slug));
    if (!files.has('SKILL.md')) throw workbenchError(`技能 ${slug} 缺少 SKILL.md`);
    skills.push({ slug, files });
  }
  return skills;
}
