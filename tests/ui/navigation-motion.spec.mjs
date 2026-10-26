import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-chromium';
const base = 'http://localhost:3100';

async function login(context, email) {
  assert.equal((await context.request.post(`${base}/api/auth/login`, { data: { email, password: 'Vectaix-Test-2026!' } })).status(), 200);
}

test('普通用户可用对话与 Media，管理后台和全局配置仅对管理员开放', { timeout: 120000 }, async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { 'x-forwarded-for': '192.0.2.220' } });
  try {
    await login(context, 'member@example.test');
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.getByRole('heading', { name: '你想完成什么？' }).waitFor();
    assert.equal(await page.getByRole('link', { name: '管理后台', exact: true }).count(), 0);
    for (const route of ['/admin', '/admin/skills', '/admin/media', '/admin/media/image']) {
      await page.goto(`${base}${route}`);
      await page.waitForURL(`${base}/`);
    }
    for (const route of ['/api/admin/models', '/api/admin/skills', '/api/admin/media']) assert.equal((await context.request.get(`${base}${route}`)).status(), 403);
    for (const route of ['/media', '/media/image', '/media/audio', '/api/media/capabilities', '/api/media/audio/fish/voices']) assert.equal((await context.request.get(`${base}${route}`)).status(), 200);
    for (const route of ['/api/memories', '/api/skills']) assert.equal((await context.request.get(`${base}${route}`)).status(), 404);
    await page.goto(`${base}/settings`);
    const navigation = page.getByRole('navigation', { name: '设置分类' });
    assert.equal(await navigation.getByRole('button', { name: /记忆|技能/ }).count(), 0);
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});

test('后台导航、资料栏与手机设置在减少动态效果时可以操作', { timeout: 120000 }, async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', extraHTTPHeaders: { 'x-forwarded-for': '192.0.2.221' } });
  try {
    await login(context, 'admin@example.test');
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/admin/media/image`);
    await page.getByRole('navigation', { name: '媒体工作区' }).getByRole('link', { name: '语音合成' }).click();
    await page.waitForURL(`${base}/admin/media/audio`);
    await page.getByRole('tab', { name: '声音复刻' }).click();
    await page.getByRole('tabpanel', { name: '声音复刻' }).waitFor();
    await page.getByRole('link', { name: '返回花卷' }).click();
    await page.waitForURL(`${base}/`);
    await page.getByRole('button', { name: '查看资料与成果', exact: true }).click();
    await page.getByRole('complementary', { name: '对话资料与成果' }).waitFor();
    await page.getByRole('tab', { name: '成果与引用', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('complementary', { name: '对话资料与成果' }).waitFor({ state: 'hidden' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/settings?section=general`);
    await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: /助手/ }).click();
    await page.getByRole('heading', { name: '助手', exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByRole('button', { name: '全部设置', exact: true }).click();
    await page.getByRole('navigation', { name: '设置分类' }).waitFor();
    await page.getByRole('link', { name: '管理后台', exact: true }).click();
    await page.waitForURL(`${base}/admin`);
    await page.getByRole('heading', { name: '模型设置' }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});

test('导航请求延迟时展示进度且保持画面可刷新', { timeout: 120000 }, async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { 'x-forwarded-for': '192.0.2.230' } });
  let release;
  const held = new Promise(resolve => { release = resolve; });
  try {
    await login(context, 'admin@example.test');
    const page = await context.newPage();
    await page.route('**/*', async route => {
      if (new URL(route.request().url()).pathname === '/admin' && route.request().headers().rsc === '1') await held;
      await route.continue();
    });
    await page.goto(base);
    await page.getByRole('link', { name: '管理后台', exact: true }).click();
    await page.getByRole('status', { name: '正在切换页面' }).waitFor();
    const frames = await page.evaluate(() => new Promise(resolve => {
      let frames = 0; const end = performance.now() + 250;
      const tick = () => { frames++; if (performance.now() >= end) resolve(frames); else requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }));
    assert.ok(frames > 3);
    release();
    await page.waitForURL(`${base}/admin`);
    await page.getByRole('status', { name: '正在切换页面' }).waitFor({ state: 'hidden' });
  } finally { release(); await context.close(); await browser.close(); }
});
