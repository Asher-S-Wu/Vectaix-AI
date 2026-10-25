import test from 'node:test';
import assert from 'node:assert/strict';
import { createSandboxSession } from '../../lib/server/sandbox/runtime.js';

const config = { apiKey: 'fixture-token', environmentId: '11111111-2222-4333-8444-555555555555', cpu: 1, memoryGB: 2, timeoutSeconds: 120, setupCommand: '' };

function fixture() {
  const files = new Map(), executions = [];
  let destroyed = 0;
  const sandbox = {
    files: {
      write: async (filename, data) => { files.set(filename, Buffer.from(data)); },
      read: async filename => files.get(filename),
      stat: async filename => ({ size: files.get(filename).length, isDir: false }),
    },
    exec: async (command, options) => {
      executions.push({ command, options });
      files.set('/home/user/work/result.txt', Buffer.from(`step ${executions.length}`));
      return { exitCode: 0, stdout: `step ${executions.length}\n`, stderr: '', timedOut: false, truncated: false };
    },
    destroy: async () => { destroyed++; },
  };
  const template = { withPackages() { return this; }, run() { return this; }, withEnv() { return this; } };
  return { files, executions, sandbox, get destroyed() { return destroyed; }, SandboxClass: { template: () => template, create: async () => sandbox } };
}

test('a task session shares files across Python and skill steps and closes once', async () => {
  const remote = fixture();
  const session = await createSandboxSession({ config }, { SandboxClass: remote.SandboxClass });
  await session.writeFiles([{ path: '/home/user/work/data.csv', data: Buffer.from('value\n5\n') }]);
  const python = await session.runPython('print("first step")');
  assert.equal(python.stdout, 'step 1\n');
  assert.ok([...remote.files].some(([filename, data]) => filename.endsWith('.py') && data.toString() === 'print("first step")'));
  const script = await session.runScript({ path: '/home/user/skills/report/scripts/run.py', args: ['--title', "User's report"], cwd: '/home/user/skills/report' });
  assert.equal(script.stdout, 'step 2\n');
  assert.equal(remote.files.get('/home/user/work/data.csv').toString(), 'value\n5\n');
  assert.equal((await session.readFile('/home/user/work/result.txt')).toString(), 'step 2');
  assert.deepEqual(await session.statFile('/home/user/work/result.txt'), { size: 6, type: 'file' });
  assert.equal(remote.executions.length, 2);
  assert.equal(remote.executions[1].options.timeoutSec, 120);
  assert.match(remote.executions[1].command, /\/home\/user\/skills\/report\/scripts\/run\.py/);
  await Promise.all([session.close(), session.close()]);
  assert.equal(remote.destroyed, 1);
});

test('canceling during creation destroys the returned sandbox before exposing a session', async () => {
  const remote = fixture(), controller = new AbortController();
  let release;
  remote.SandboxClass.create = () => new Promise(resolve => { release = resolve; });
  const creating = createSandboxSession({ config, signal: controller.signal }, { SandboxClass: remote.SandboxClass });
  const reason = new Error('task stopped');
  const rejected = assert.rejects(creating, error => error === reason);
  controller.abort(reason);
  release(remote.sandbox);
  await rejected;
  assert.equal(remote.destroyed, 1);
  assert.equal(remote.executions.length, 0);
});
