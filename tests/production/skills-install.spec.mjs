import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

test('production API installs a GitHub skill with the real Skills CLI', { timeout: 180000 }, async () => {
  const database = await MongoMemoryServer.create();
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vectaix-production-skills-'));
  const connection = await mongoose.createConnection(database.getUri()).asPromise();
  let server;
  let stopped;
  let output = '';
  try {
    const userId = new mongoose.Types.ObjectId();
    const token = crypto.randomBytes(32).toString('base64url');
    await connection.collection('users').insertOne({ _id: userId, email: 'admin@example.test', password: 'test-account' });
    await connection.collection('sessions').insertOne({
      userId,
      tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() + 180000),
    });

    const listener = net.createServer();
    listener.listen(0, '127.0.0.1');
    await once(listener, 'listening');
    const port = listener.address().port;
    await new Promise(resolve => listener.close(resolve));
    const base = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
      windowsHide: true,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        NEXT_TELEMETRY_DISABLED: '1',
        MONGO_URI: database.getUri(),
        STORAGE_ROOT: directory,
        ADMIN_EMAILS: 'admin@example.test',
        APP_SECRETS_KEY: crypto.randomBytes(32).toString('base64'),
        DEEPSEEK_API_KEY: '',
        MICU_OPENAI_IMAGE_API_KEY: '',
        ELEVENLABS_API_KEY: '',
        PUBLIC_APP_URL: base,
        NEXT_PUBLIC_APP_URL: base,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    stopped = once(server, 'exit');
    server.stdout.on('data', chunk => { output += chunk; });
    server.stderr.on('data', chunk => { output += chunk; });

    const deadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() < deadline && server.exitCode === null) {
      try { ready = (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) })).ok; }
      catch (error) { if (error.name !== 'TimeoutError' && error.cause?.code !== 'ECONNREFUSED') throw error; }
      if (ready) break;
      await setTimeout(250);
    }
    assert.ok(ready, `Production server failed to start:\n${output}`);

    const headers = { 'Content-Type': 'application/json', Cookie: `token=${token}` };
    const response = await fetch(`${base}/api/admin/skills`, {
      method: 'POST', headers,
      body: JSON.stringify({ source: 'https://github.com/blader/humanizer', skill: 'humanizer' }),
    });
    const result = await response.json();
    assert.equal(response.status, 200, `${JSON.stringify(result)}\n${output}`);
    assert.ok(result.skills.some(skill => skill.slug === 'humanizer' && skill.enabled && skill.source.url === 'https://github.com/blader/humanizer'));
    const listed = await fetch(`${base}/api/admin/skills`, { headers });
    assert.equal(listed.status, 200);
    assert.ok((await listed.json()).skills.some(skill => skill.slug === 'humanizer'));
    const installed = await connection.collection('workbenchskills').findOne({ slug: 'humanizer' });
    assert.ok(installed?.content.includes('Humanizer'));
  } finally {
    if (server && server.exitCode === null) server.kill();
    if (stopped) await stopped;
    await connection.close();
    await database.stop();
    assert.ok(directory.startsWith(path.join(os.tmpdir(), 'vectaix-production-skills-')));
    await rm(directory, { recursive: true, force: true });
  }
});
