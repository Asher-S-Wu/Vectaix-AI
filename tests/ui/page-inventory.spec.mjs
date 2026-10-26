import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir } from 'node:fs/promises';
import { chromium } from 'playwright-chromium';

const base = 'http://localhost:3100';
const pages = (await readdir(new URL('../../app', import.meta.url), { recursive: true })).filter(name => name === 'page.js' || name.endsWith('/page.js')).map(name => `/${name.replace(/(^|\/)page\.js$/, '')}`).filter(route => route !== '/settings').sort();
const sections = ['general', 'assistant', 'connections', 'browser', 'files', 'backups', 'permissions', 'usage'];
const routes = [...pages, ...sections.map(section => `/settings?section=${section}`)];

test('逐页检查全部前后台页面和八项设置在桌面与手机深色下的渲染、权限和横向布局', { timeout: 240000 }, async () => {
  const browser = await chromium.launch();
  let checked = 0;
  try {
    for (const [index, viewport, colorScheme] of [[0, { width: 1440, height: 1000 }, 'light'], [1, { width: 390, height: 844 }, 'dark']]) {
      const contexts = {};
      for (const [roleIndex, role] of ['member', 'admin'].entries()) {
        const context = await browser.newContext({ locale: 'zh-CN', viewport, colorScheme, reducedMotion: 'reduce', extraHTTPHeaders: { 'x-forwarded-for': `192.0.2.${220 + index * 2 + roleIndex}` } });
        assert.equal((await context.request.post(`${base}/api/auth/login`, { data: { email: `${role}@example.test`, password: 'Vectaix-Test-2026!' } })).status(), 200);
        contexts[role] = context;
      }
      try {
        for (const route of routes) {
          const page = await contexts[route.startsWith('/admin') ? 'admin' : 'member'].newPage();
          const errors = [];
          page.on('pageerror', error => errors.push(error.message));
          const response = await page.goto(`${base}${route}`, { waitUntil: 'networkidle' });
          assert.equal(response.status(), 200, `${route}: HTTP status`);
          assert.equal(new URL(page.url()).pathname, route.split('?')[0], `${route}: page identity`);
          assert.match(await page.title(), /花卷/);
          if (index === 1 && route === '/settings?section=general') await page.getByRole('button', { name: /^通用/ }).click();
          await page.getByRole('heading').first().waitFor({ state: 'visible' });
          assert.equal(await page.getByText('Application error:', { exact: false }).count(), 0, `${route}: framework error`);
          assert.deepEqual(errors, [], `${route}: runtime errors`);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${route}: horizontal overflow at ${viewport.width}`);
          if (route.startsWith('/admin')) assert.equal(await page.getByRole('navigation', { name: '后台管理', exact: true }).count(), 1);
          if (route.startsWith('/media')) assert.equal(await page.getByRole('navigation', { name: '工作空间', exact: true }).count(), 1);
          checked++;
          await page.close();
        }
      } finally { await Promise.all(Object.values(contexts).map(context => context.close())); }
    }
    assert.equal(checked, routes.length * 2);
    console.log(`Verified ${routes.length} page states across two viewport/theme combinations (${checked} checks).`);
  } finally { await browser.close(); }
});
