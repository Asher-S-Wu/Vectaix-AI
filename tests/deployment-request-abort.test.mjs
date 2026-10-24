import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { getCloneableBody } from 'next/dist/server/body-streams.js';

test('代理替换请求体后保留断连监听、销毁行为和正文', async () => {
  const request = new Readable({ read() {} });
  const originalDestroy = (error, callback) => callback(error);
  const onError = () => {};
  request._destroy = originalDestroy;
  request.on('error', onError);

  const body = getCloneableBody(request);
  body.cloneBodyStream().resume();
  request.push('hello');
  request.push(null);
  await body.finalize();

  assert.ok(request.listeners('error').includes(onError), '请求原有的 error 监听器应保留');
  assert.equal(request._destroy, originalDestroy, '请求原有的 _destroy 实现应保留');

  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString(), 'hello');
  assert.doesNotThrow(() => request.emit('error', Object.assign(new Error('aborted'), { code: 'ECONNRESET' })));
});
