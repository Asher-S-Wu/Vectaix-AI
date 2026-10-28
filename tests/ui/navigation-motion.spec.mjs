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
    for (const route of ['/settings?section=admin', '/settings?section=admin&adminSection=skills', '/settings?section=admin&adminSection=media', '/settings?section=admin&adminSection=image']) {
      await page.goto(`${base}${route}`);
      await page.waitForURL(`${base}/`);
    }
    for (const route of ['/api/admin/models', '/api/admin/skills', '/api/admin/media']) assert.equal((await context.request.get(`${base}${route}`)).status(), 403);
    for (const route of ['/media', '/media/image', '/media/audio', '/api/media/capabilities', '/api/media/audio/elevenlabs/voices']) assert.equal((await context.request.get(`${base}${route}`)).status(), 200);
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
    await page.goto(`${base}/settings?section=admin&adminSection=image`);
    await page.getByRole('navigation', { name: '媒体工作区' }).getByRole('button', { name: '语音合成' }).click();
    await page.waitForURL(`${base}/settings?section=admin&adminSection=audio`);
    await page.getByRole('tab', { name: '声音复刻' }).click();
    await page.getByRole('tabpanel', { name: '声音复刻' }).waitFor();
    await page.getByRole('link', { name: '返回对话' }).click();
    await page.waitForURL(`${base}/`);
    await page.getByRole('button', { name: '资料与成果', exact: true }).click();
    await page.getByRole('complementary', { name: '对话资料与成果' }).waitFor();
    await page.getByRole('tab', { name: '成果与引用', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.keyboard.press('Escape');
    await page.getByRole('complementary', { name: '对话资料与成果' }).waitFor({ state: 'hidden' });
    await page.goto(`${base}/settings?section=general`);
    await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: /助手/ }).click();
    await page.getByRole('heading', { name: '助手', exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByRole('button', { name: '全部设置', exact: true }).click();
    await page.getByRole('navigation', { name: '设置分类' }).waitFor();
    await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: /^管理后台/ }).click();
    await page.waitForURL(`${base}/settings?section=admin&adminSection=models`);
    await page.getByRole('heading', { name: '模型服务' }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});

test('管理后台在设置右侧切换，保留列表、返回来源与可刷新的当前栏目', { timeout: 90000 }, async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', extraHTTPHeaders: { 'x-forwarded-for': '192.0.2.234' } });
  try {
    await login(context, 'admin@example.test');
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/settings?section=general&returnTo=%2Fmedia%2Faudio`, { waitUntil: 'networkidle' });
    const navigation = page.getByRole('navigation', { name: '设置分类', exact: true });
    await navigation.evaluate(element => { element.dataset.instance = 'settings-list'; });
    const requests = [];
    page.on('request', request => {
      if (request.isNavigationRequest() || (new URL(request.url()).pathname === '/settings' && request.headers().rsc === '1')) requests.push(request.url());
    });
    await navigation.getByRole('button', { name: '管理后台', exact: true }).click();
    await page.getByRole('heading', { name: '模型服务', exact: true }).waitFor();
    assert.equal(await navigation.getByRole('button', { name: '管理后台', exact: true }).getAttribute('aria-current'), 'page');
    const adminNavigation = page.getByRole('navigation', { name: '后台管理', exact: true });
    for (const name of ['全局技能', '云端沙盒', '图片与语音']) {
      await adminNavigation.getByRole('button', { name, exact: true }).click();
      await page.getByRole('heading', { name, exact: true }).waitFor();
      assert.equal(await navigation.getAttribute('data-instance'), 'settings-list');
    }
    await page.getByRole('navigation', { name: '媒体工作区', exact: true }).getByRole('button', { name: '语音合成', exact: true }).click();
    await page.getByRole('tab', { name: '声音复刻' }).waitFor();
    await navigation.getByRole('button', { name: '助手', exact: true }).click();
    await page.getByRole('heading', { name: '助手', exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.has('adminSection'), false);
    await navigation.getByRole('button', { name: '管理后台', exact: true }).click();
    await page.getByRole('tab', { name: '声音复刻' }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/settings');
    assert.equal(new URL(page.url()).searchParams.get('adminSection'), 'audio');
    assert.equal(new URL(page.url()).searchParams.get('returnTo'), '/media/audio');
    assert.deepEqual(requests, []);
    assert.equal(context.pages().length, 1);
    await page.reload();
    await page.getByRole('tab', { name: '声音复刻' }).waitFor();
    assert.equal(await page.getByRole('link', { name: '返回媒体创作', exact: true }).getAttribute('href'), '/media/audio');
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});

test('首页与设置原地过渡，慢请求期间显示已有设置，返回和前进保留对话草稿', { timeout: 90000 }, async () => {
  const browser = await chromium.launch();
  try {
    for (const [index, width, reducedMotion] of [[0, 1360, 'no-preference'], [1, 390, 'reduce']]) {
      const context = await browser.newContext({ locale: 'zh-CN', viewport: { width, height: 900 }, reducedMotion, extraHTTPHeaders: { 'x-forwarded-for': `192.0.2.${236 + index}` } });
      let release;
      const held = new Promise(resolve => { release = resolve; });
      try {
        await login(context, 'admin@example.test');
        const page = await context.newPage();
        const errors = [], navigations = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(base);
        if (width < 768) await page.getByRole('button', { name: '打开对话列表', exact: true }).click();
        await page.getByRole('button', { name: '设置', exact: true }).waitFor();
        if (width < 768) await page.getByRole('button', { name: '关闭对话列表', exact: true }).click();
        const composer = page.getByRole('textbox', { name: '消息', exact: true });
        await composer.fill('进入设置前写下的草稿');
        await page.waitForFunction(() => !document.querySelector('button[aria-label="发送"]').disabled);
        await composer.evaluate(element => { element.dataset.instance = 'original-composer'; });
        await page.route('**/api/settings', async route => { await held; await route.continue(); });
        page.on('request', request => {
          const url = new URL(request.url());
          if (request.isNavigationRequest() || (url.pathname === '/settings' && url.searchParams.get('section') === 'general' && request.headers().rsc === '1')) navigations.push(request.url());
        });
        if (width < 768) await page.getByRole('button', { name: '打开对话列表', exact: true }).click();
        await page.getByRole('button', { name: '设置', exact: true }).click();
        await page.waitForURL(`${base}/settings?section=general`);
        if (width < 768) await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: /^通用/ }).click();
        await page.getByLabel('昵称', { exact: true }).waitFor();
        assert.equal(await page.getByText('正在加载设置…', { exact: true }).count(), 0);
        assert.equal(await page.getByRole('status', { name: '正在切换页面', exact: true }).count(), 0);
        assert.deepEqual(navigations, []);
        assert.equal(await page.getByRole('textbox', { name: '消息', exact: true }).count(), 0);
        release();
        await page.goBack();
        await composer.waitFor();
        assert.equal(await composer.inputValue(), '进入设置前写下的草稿');
        assert.equal(await composer.getAttribute('data-instance'), 'original-composer');
        await page.goForward();
        await page.waitForURL(`${base}/settings?section=general`);
        if (width < 768) await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: /^通用/ }).click();
        await page.getByLabel('昵称', { exact: true }).waitFor();
        if (width < 768) await page.getByRole('button', { name: '全部设置', exact: true }).click();
        await page.getByRole('link', { name: '返回对话', exact: true }).click();
        await composer.waitFor();
        assert.equal(await composer.inputValue(), '进入设置前写下的草稿');
        assert.equal(await composer.getAttribute('data-instance'), 'original-composer');
        if (width < 768) await page.getByRole('button', { name: '打开对话列表', exact: true }).click();
        await page.getByRole('button', { name: '设置', exact: true }).click();
        await page.waitForURL(`${base}/settings?section=general`);
        await page.reload();
        if (width < 768) await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: /^通用/ }).click();
        await page.getByLabel('昵称', { exact: true }).waitFor();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert.deepEqual(errors, []);
      } finally { release(); await context.close(); }
    }
  } finally { await browser.close(); }
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
      const url = new URL(route.request().url());
      if (url.pathname === '/media' && route.request().headers().rsc === '1') await held;
      await route.continue();
    });
    await page.goto(base);
    await page.getByRole('link', { name: '媒体创作', exact: true }).click();
    await page.getByRole('status', { name: '正在切换页面' }).waitFor();
    const frames = await page.evaluate(() => new Promise(resolve => {
      let frames = 0; const end = performance.now() + 250;
      const tick = () => { frames++; if (performance.now() >= end) resolve(frames); else requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }));
    assert.ok(frames > 3);
    release();
    await page.waitForURL(`${base}/media`);
    await page.getByRole('status', { name: '正在切换页面' }).waitFor({ state: 'hidden' });
  } finally { release(); await context.close(); await browser.close(); }
});
