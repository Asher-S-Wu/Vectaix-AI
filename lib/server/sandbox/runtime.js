import crypto from 'node:crypto';
import path from 'node:path';
import { Sandbox } from 'railway';
import { sandboxError } from './settings';

const WORKSPACE = '/home/user/work';
const PYTHON = '/opt/huajuan-python/bin/python';
const RUNTIME_PATH = '/opt/huajuan-python/bin:/usr/local/bin:/usr/bin:/bin';
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const INTERPRETERS = { py: PYTHON, sh: '/bin/bash', bash: '/bin/bash', js: '/usr/bin/node', mjs: '/usr/bin/node', cjs: '/usr/bin/node' };
const quote = value => `'${String(value).replaceAll("'", "'\"'\"'")}'`;

function executionCommand(command, cwd) {
  return [
    'bwrap', '--unshare-all', '--die-with-parent', '--new-session', '--uid', '1000', '--gid', '1000', '--cap-drop', 'ALL', '--clearenv',
    '--ro-bind', '/usr', '/usr', '--ro-bind', '/bin', '/bin', '--ro-bind', '/lib', '/lib', '--ro-bind', '/lib64', '/lib64',
    '--ro-bind', '/etc', '/etc', '--ro-bind', '/opt', '/opt', '--bind', '/home/user', '/home/user',
    '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
    '--setenv', 'HOME', '/home/user', '--setenv', 'PATH', RUNTIME_PATH, '--setenv', 'LANG', 'C.UTF-8',
    '--setenv', 'MPLBACKEND', 'Agg', '--setenv', 'PYTHONUNBUFFERED', '1', '--setenv', 'HUAJUAN_WORKSPACE', WORKSPACE,
    '--chdir', cwd, '--', ...command,
  ].map(quote).join(' ');
}

export async function createSandboxSession({ config, signal }, { SandboxClass = Sandbox } = {}) {
  signal?.throwIfAborted();
  let template = SandboxClass.template()
    .withPackages('python3', 'python3-venv', 'nodejs', 'bubblewrap')
    .run('python3 -m venv /opt/huajuan-python && /opt/huajuan-python/bin/pip install --no-cache-dir pandas numpy matplotlib openpyxl python-docx pillow pypdf')
    .withEnv({ PATH: RUNTIME_PATH });
  if (config.setupCommand) template = template.run(config.setupCommand);
  template = template.run('mkdir -p /home/user/work /home/user/skills /home/user/.cache');

  let sandbox;
  try {
    sandbox = await SandboxClass.create(template, {
      token: config.apiKey, authType: 'bearer', environmentId: config.environmentId,
      resources: { cpu: config.cpu, memoryGB: config.memoryGB }, idleTimeoutMinutes: 20,
      networkIsolation: 'ISOLATED', env: {},
    });
  } catch {
    signal?.throwIfAborted();
    throw sandboxError('沙盒创建失败，请管理员检查 Railway Token、环境和资源配置', 502);
  }

  let closing;
  const close = () => {
    if (!closing) {
      signal?.removeEventListener('abort', onAbort);
      closing = sandbox.destroy().catch(() => { throw sandboxError('沙盒回收失败，请管理员检查 Railway 中的运行状态', 502); });
    }
    return closing;
  };
  const onAbort = () => { void close().catch(() => {}); };
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) { await close(); signal.throwIfAborted(); }

  function assertOpen() {
    signal?.throwIfAborted();
    if (closing) throw sandboxError('沙盒已关闭，请开始新任务');
  }

  async function run(command, cwd) {
    assertOpen();
    try {
      return await sandbox.exec(executionCommand(command, cwd), {
        timeoutSec: config.timeoutSeconds, signal, ephemeral: true, maxOutputBytes: 16000,
      });
    } catch {
      signal?.throwIfAborted();
      throw sandboxError('云端执行连接中断，请重新开始任务', 502);
    }
  }

  return {
    workspace: WORKSPACE,
    close,
    async runPython(code) {
      assertOpen();
      const filename = `/home/user/.huajuan-${crypto.randomUUID()}.py`;
      await sandbox.files.write(filename, code);
      return run([PYTHON, filename], WORKSPACE);
    },
    runScript({ path: filename, args, cwd }) {
      const interpreter = INTERPRETERS[path.posix.extname(filename).slice(1).toLowerCase()];
      if (!interpreter) throw sandboxError('技能脚本请选择 Python、Bash 或 Node.js 文件');
      return run([interpreter, filename, ...args], cwd);
    },
    async writeFiles(files) {
      for (const file of files) { assertOpen(); await sandbox.files.write(file.path, file.data); }
    },
    async statFile(filename) {
      assertOpen();
      const info = await sandbox.files.stat(filename);
      return { size: info.size, type: info.isDir ? 'directory' : 'file' };
    },
    async readFile(filename) {
      assertOpen();
      const bytes = await sandbox.files.read(filename, { format: 'bytes', length: MAX_FILE_BYTES + 1 });
      assertOpen();
      if (bytes.length > MAX_FILE_BYTES) throw sandboxError('沙盒文件每个最多 20 MB，每批最多 50 MB');
      return bytes;
    },
  };
}

export async function testSandboxConnection(config) {
  const session = await createSandboxSession({ config });
  try {
    const result = await session.runPython('import sys, pandas, matplotlib, docx\nprint("Python " + sys.version.split()[0])\nprint("2 + 3 =", 2 + 3)\nprint("Data and document libraries ready")');
    if (result.exitCode !== 0) throw sandboxError('Python 测试失败，请检查沙盒初始化命令和运行环境', 502);
    return { ok: true, output: result.stdout };
  } finally { await session.close(); }
}
