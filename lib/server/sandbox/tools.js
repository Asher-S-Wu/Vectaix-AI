import path from 'node:path';
import StoredFile from '@/models/StoredFile';
import SkillAsset from '@/models/SkillAsset';
import { requireSkill } from '@/lib/server/skills/service';
import { createScopedFileQuery } from '@/lib/server/workbench/documents';
import { defineTaskTool } from '@/lib/server/workbench/tools';
import { createStoredFile, deleteStoredFileDocument, readStoredFileBuffer } from '@/lib/server/storage/service';
import { inspectUploadedFile } from '@/lib/server/storage/fileInspection';
import { registerIntegrationFile } from '@/lib/server/integrations/artifacts';
import { getSandboxConnection } from './settings';
import { createSandboxSession } from './runtime';

const WORKSPACE = '/home/user/work';
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_BATCH_BYTES = 50 * 1024 * 1024;
const SCRIPT_EXTENSIONS = new Set(['py', 'sh', 'bash', 'js', 'mjs', 'cjs']);
const MIME_TYPES = {
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv', txt: 'text/plain', md: 'text/markdown', json: 'application/json',
  html: 'text/html', svg: 'image/svg+xml', zip: 'application/zip', py: 'text/plain', js: 'text/javascript',
};
const relativeFile = { type: 'string', minLength: 1, maxLength: 500 };
const filesSchema = {
  type: 'array', maxItems: 10, description: '复制到工作目录的输入文件，path 为相对路径；无需新增输入时传空数组。',
  items: { type: 'object', properties: { fileId: { type: 'string' }, path: relativeFile }, required: ['fileId', 'path'], additionalProperties: false },
};
const outputsSchema = { type: 'array', maxItems: 10, uniqueItems: true, items: relativeFile, description: '运行成功后要交付的文件相对路径，自动保存到对话；只需计算结果时传空数组。' };

function relativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 500 || value.includes('\\') || value.startsWith('/') || /[\x00-\x1f:]/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('请使用沙盒工作目录内的相对文件路径');
  }
  return value;
}

export async function registerSandboxTools({ registry, task, signal, assertActive }, { createSession = createSandboxSession } = {}) {
  const config = await getSandboxConnection();
  let sessionPromise;
  const cleanup = async () => {
    const sandbox = await sessionPromise?.catch(() => null);
    if (sandbox) await sandbox.close();
  };
  if (!config) return cleanup;
  const userId = String(task.userId);
  const uploadedSkills = new Set();
  const session = () => sessionPromise ??= createSession({ config, signal });

  async function uploadInputs(sandbox, files) {
    if (!files.length) return;
    const scope = await createScopedFileQuery({ userId, conversationId: String(task.conversationId), projectId: task.projectId ? String(task.projectId) : null });
    let total = 0;
    for (const input of files) {
      await assertActive();
      const destination = `${WORKSPACE}/${relativePath(input.path)}`;
      const file = await StoredFile.findOne({ ...scope, fileId: input.fileId });
      if (!file) throw new Error('沙盒输入文件不在当前资料范围内');
      total += file.size;
      if (file.size > MAX_FILE_BYTES || total > MAX_BATCH_BYTES) throw new Error('沙盒文件每个最多 20 MB，每批最多 50 MB');
      await sandbox.writeFiles([{ path: destination, data: await readStoredFileBuffer(file) }]);
    }
  }

  async function saveOutputs(sandbox, outputs) {
    const pending = [];
    let total = 0;
    for (const output of outputs) {
      const destination = `${WORKSPACE}/${relativePath(output)}`;
      const info = await sandbox.statFile(destination);
      if (info.type !== 'file' || info.size <= 0) throw new Error('请选择有内容的沙盒输出文件');
      total += info.size;
      if (info.size > MAX_FILE_BYTES || total > MAX_BATCH_BYTES) throw new Error('沙盒文件每个最多 20 MB，每批最多 50 MB');
      pending.push({ destination, size: info.size });
    }
    const artifacts = [];
    for (const { destination, size } of pending) {
      await assertActive();
      const input = Buffer.from(await sandbox.readFile(destination));
      if (input.length !== size) throw new Error('沙盒输出文件发生变化，请完成写入后再导出');
      await assertActive();
      const name = path.posix.basename(destination), extension = path.posix.extname(name).slice(1).toLowerCase() || 'bin';
      const media = inspectUploadedFile(input, extension);
      const file = await createStoredFile({ userId, input, originalName: name, extension, mimeType: media?.mimeType || MIME_TYPES[extension] || 'application/octet-stream', category: media?.category || 'document', kind: 'task-artifact', ownerType: 'task', ownerId: String(task._id) });
      try { artifacts.push(await registerIntegrationFile({ userId, task, file, input })); }
      catch (error) { await deleteStoredFileDocument(file); throw error; }
    }
    return artifacts;
  }

  async function execute({ files, outputs }, run) {
    await assertActive();
    for (const output of outputs) relativePath(output);
    const sandbox = await session();
    await uploadInputs(sandbox, files);
    const result = await run(sandbox);
    await assertActive();
    return { ...result, workspace: WORKSPACE, files: result.exitCode === 0 ? await saveOutputs(sandbox, outputs) : [] };
  }

  registry.add(defineTaskTool('run_python', '在独立云端沙盒执行 Python，处理数据、计算或生成文件。工作目录为 /home/user/work，同一任务的文件持续保留，每次调用是新进程。网络关闭，使用环境预装的库；错误会返回供你修正。outputs 中的文件会直接交付用户。', {
    code: { type: 'string', minLength: 1, maxLength: 200000, description: '完整 Python 代码；输入和输出路径相对于 /home/user/work。' },
    files: filesSchema, outputs: outputsSchema,
  }, args => execute(args, sandbox => sandbox.runPython(args.code))));

  registry.add(defineTaskTool('run_skill_script', '在云端运行管理员启用技能中的 Python、Bash 或 Node.js 脚本。先 load_skill 阅读用法。技能目录作为进程工作目录，传入和交付文件使用 /home/user/work 下的绝对路径。配套资料会一起上传，网络关闭，使用环境预装依赖。', {
    skillId: { type: 'string', description: '已启用技能编号' }, path: { ...relativeFile, description: '技能包内的脚本路径，例如 scripts/run.py' },
    args: { type: 'array', maxItems: 64, items: { type: 'string', maxLength: 4096 }, description: '逐项传递的脚本参数，无参数时传空数组。工作文件路径以 /home/user/work/ 开头。' },
    files: filesSchema, outputs: outputsSchema,
  }, async args => {
    const scriptPath = relativePath(args.path);
    if (!SCRIPT_EXTENSIONS.has(path.posix.extname(scriptPath).slice(1).toLowerCase())) throw new Error('技能脚本请选择 Python、Bash 或 Node.js 文件');
    const skill = await requireSkill(args.skillId);
    if (!skill.enabled) throw new Error('管理员已停用此技能');
    const directory = `/home/user/skills/${skill._id}/${skill.revision}`;
    return execute(args, async sandbox => {
      if (!uploadedSkills.has(directory)) {
        const assets = await SkillAsset.find({ skillId: skill._id, revision: skill.revision });
        if (!assets.some(asset => asset.path === scriptPath)) throw new Error('技能附件不存在');
        const uploads = [{ path: `${directory}/SKILL.md`, data: skill.content }, ...assets.map(asset => ({ path: `${directory}/${relativePath(asset.path)}`, data: Buffer.from(asset.data) }))];
        if (uploads.reduce((sum, file) => sum + Buffer.byteLength(file.data), 0) > MAX_BATCH_BYTES) throw new Error('技能文件总大小超过 50 MB');
        await sandbox.writeFiles(uploads);
        uploadedSkills.add(directory);
      } else if (!await SkillAsset.exists({ skillId: skill._id, revision: skill.revision, path: scriptPath })) throw new Error('技能附件不存在');
      return sandbox.runScript({ path: `${directory}/${scriptPath}`, args: args.args, cwd: directory });
    });
  }));
  return cleanup;
}
