import 'next/dist/server/node-environment.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server.js';
import { getMiddlewareMatchers } from 'next/dist/build/analysis/get-page-static-info.js';
import { getMiddlewareRouteMatcher } from 'next/dist/shared/lib/router/utils/middleware-route-matcher.js';
import { proxy, config } from '../../proxy.js';

const matches = getMiddlewareRouteMatcher(getMiddlewareMatchers(config.matcher, {}));

test('页面上的表单扫描在进入 Server Action 处理前被拒绝', () => {
  for (const pathname of ['/', '/settings', '/api', '/apiary', '/icon-test', '/apple-icon-test', '/favicon.ico-test', '/manifest.webmanifest-test']) {
    const body = new FormData();
    body.set('$ACTION_ID_x', '');
    const request = new NextRequest(`https://app.test${pathname}`, { method: 'POST', body });
    assert.equal(matches(pathname, request, {}), true, pathname);
    const response = proxy(request);
    assert.equal(response.status, 405, pathname);
    assert.equal(response.headers.get('allow'), 'GET, HEAD');
    assert.equal(response.headers.get('x-middleware-next'), null);
  }
});

test('伪造的 Server Action 请求头在页面和 API 路径上都被拦截', () => {
  for (const pathname of ['/', '/api', '/api/health', '/api/does-not-exist', '/apiary']) {
    for (const actionId of ['1', 'action', 'x', '0', 'a'.repeat(42)]) {
      const request = new NextRequest(`https://app.test${pathname}`, {
        method: 'POST', headers: { 'next-action': actionId }, body: '[]',
      });
      assert.equal(matches(pathname, request, {}), true, pathname);
      const response = proxy(request);
      assert.equal(response.status, 404, pathname);
      assert.equal(response.headers.get('x-middleware-next'), null);
    }
  }
});

test('正常 API 登录和文件上传保留请求体并交给接口处理', async () => {
  const login = new NextRequest('https://app.test/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'member@example.test', password: 'test-password' }),
  });
  assert.equal(matches('/api/auth/login', login, {}), true);
  assert.equal(proxy(login).headers.get('x-middleware-next'), '1');
  assert.equal((await login.json()).email, 'member@example.test');

  const form = new FormData();
  form.set('file', new File(['test upload'], 'sample.txt', { type: 'text/plain' }));
  const upload = new NextRequest('https://app.test/api/upload', { method: 'POST', body: form });
  const response = proxy(upload);
  assert.equal(response.headers.get('x-middleware-next'), '1');
  assert.equal(response.headers.get('x-middleware-override-headers'), null);
  assert.equal(response.headers.get('content-security-policy'), null);
  assert.equal(await (await upload.formData()).get('file').text(), 'test upload');
});

test('正常页面访问保留安全策略，真实静态资源跳过代理', () => {
  for (const method of ['GET', 'HEAD']) {
    const request = new NextRequest('https://app.test/settings', { method });
    const response = proxy(request);
    assert.equal(response.headers.get('x-middleware-next'), '1');
    const nonce = response.headers.get('x-middleware-request-x-csp-nonce');
    assert.ok(nonce);
    assert.ok(response.headers.get('content-security-policy').includes(`'nonce-${nonce}'`));
  }
  for (const pathname of ['/_next/static/chunk.js', '/_next/image', '/icon', '/apple-icon', '/favicon.ico', '/manifest.webmanifest']) {
    const request = new NextRequest(`https://app.test${pathname}`);
    assert.equal(matches(pathname, request, {}), false, pathname);
  }
});
