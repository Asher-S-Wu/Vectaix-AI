import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import NextServerModule from 'next/dist/server/next-server.js';
import { defaultConfig } from 'next/dist/server/config-shared.js';
import { NodeNextRequest, NodeNextResponse } from 'next/dist/server/base-http/node.js';
import { addRequestMeta } from 'next/dist/server/request-meta.js';
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

// 直接运行 Next.js 的代理异常处理，跳过与断连无关的构建文件加载。
class RequestAbortTestServer extends NextServerModule.default {
  loadEnvConfig() {}
  async prepare() {}
  getBuildId() { return 'request-abort-test'; }
  getEnabledDirectories() { return { app: false, pages: false }; }
  getNextFontManifest() { return {}; }
  getPrefetchHints() { return {}; }
  getPreviewProps() { return {}; }
  getPagesManifest() { return {}; }
  getAppPathsManifest() { return {}; }
  getPrerenderManifest() {
    return { version: 4, routes: {}, dynamicRoutes: {}, notFoundRoutes: [], preview: {} };
  }
  getRoutesManifest() { return { dynamicRoutes: [] }; }
  async getMiddleware() { return { match: () => true }; }
  async ensureMiddleware() {}
}

test('代理读取请求体时识别真实客户端断连，同时保留其他错误', async t => {
  const next = new RequestAbortTestServer({
    dir: import.meta.dirname,
    conf: {
      ...defaultConfig,
      experimental: { ...defaultConfig.experimental, instantInsights: { validationLevel: 'warning' } },
    },
    dev: false,
    minimalMode: true,
  });
  const errors = t.mock.method(console, 'error', () => {});
  const renderError = t.mock.method(next, 'renderError', async () => {});

  try {
    for (const unrelatedError of [null, Object.assign(new Error('upstream connection reset'), { code: 'ECONNRESET' })]) {
      await t.test(unrelatedError ? '客户端断连时其他连接错误继续上报' : '请求体未传完就断开时正常结束处理', async () => {
        errors.mock.resetCalls();
        renderError.mock.resetCalls();
        const started = Promise.withResolvers();
        const handled = Promise.withResolvers();
        next.runMiddleware = async ({ request }) => {
          const body = getCloneableBody(request.originalRequest);
          body.cloneBodyStream().resume();
          started.resolve();
          try {
            await body.finalize();
          } catch (error) {
            throw unrelatedError || error;
          }
        };
        const server = createServer((request, response) => {
          const req = new NodeNextRequest(request);
          addRequestMeta(req, 'middlewareInvoke', true);
          addRequestMeta(req, 'initURL', 'http://localhost/');
          next.handleCatchallMiddlewareRequest(req, new NodeNextResponse(response), { pathname: '/' })
            .then(handled.resolve, handled.reject);
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const client = httpRequest({ host: '127.0.0.1', port: server.address().port, method: 'POST', headers: { 'Content-Length': 100 } });
        client.on('error', () => {});
        try {
          client.write('partial');
          await started.promise;
          client.destroy();
          assert.equal(await handled.promise, true);
          assert.equal(errors.mock.callCount(), unrelatedError ? 1 : 0);
          assert.equal(renderError.mock.callCount(), unrelatedError ? 1 : 0);
          if (unrelatedError) assert.equal(errors.mock.calls[0].arguments[0], unrelatedError);
        } finally {
          client.destroy();
          server.closeAllConnections();
          await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        }
      });
    }

    await t.test('连接正常时的 ECONNRESET 继续上报', async () => {
      errors.mock.resetCalls();
      renderError.mock.resetCalls();
      const error = Object.assign(new Error('upstream connection reset'), { code: 'ECONNRESET' });
      next.runMiddleware = async () => { throw error; };
      const req = { url: '/', originalRequest: { aborted: false, errored: error } };
      addRequestMeta(req, 'middlewareInvoke', true);
      addRequestMeta(req, 'initURL', 'http://localhost/');
      const res = {};
      assert.equal(await next.handleCatchallMiddlewareRequest(req, res, { pathname: '/' }), true);
      assert.equal(res.statusCode, 500);
      assert.equal(errors.mock.calls[0].arguments[0], error);
      assert.equal(renderError.mock.callCount(), 1);
    });
  } finally {
    await next.close();
  }
});
