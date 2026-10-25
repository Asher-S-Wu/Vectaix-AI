import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = (await readdir(path.join(root, 'tests'), { recursive: true }))
  .filter(name => /\.test\.(?:mjs|js)$/.test(name))
  .map(name => path.join('tests', name));
const child = spawn(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=4', ...files], {
  cwd: root,
  env: { ...process.env, TSX_TSCONFIG_PATH: 'jsconfig.json', MONGO_URI: 'mongodb://127.0.0.1/huajuan_test' },
  stdio: 'inherit',
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
