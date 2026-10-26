import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-chromium';
import { mkdir } from 'node:fs/promises';

const base = 'http://localhost:3100';
const themeKey = 'vectaix_ui_themeMode';
const screenshots = 'logs/i18n-screenshots';
let requestId = 0;

async function withPage(options, run, authenticated = false) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1360, height: 920 }, ...options, extraHTTPHeaders: { 'x-forwarded-for': `192.0.2.${70 + ++requestId}` } });
  context.setDefaultTimeout(15000);
  context.setDefaultNavigationTimeout(30000);
  try {
    if (authenticated) {
      const response = await context.request.post(`${base}/api/auth/login`, { data: { email: 'admin@example.test', password: 'Vectaix-Test-2026!' } });
      assert.equal(response.status(), 200);
    }
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await run(page, context);
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
}

test('首次访问自动识别中英文，手选语言刷新后保持，登录报错按语言显示', { timeout: 120000 }, async () => {
  for (const locale of ['zh-CN', 'en-US']) await withPage({ locale }, async page => {
    await page.goto(base);
    await page.getByRole('heading', { name: locale === 'en-US' ? 'Sign in to Huajuan' : '登录花卷', exact: true }).waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'), locale);
    const { status, payload } = await page.evaluate(async () => {
      const response = await fetch('/api/admin/models');
      return { status: response.status, payload: await response.json() };
    });
    assert.equal(status, 403);
    assert.equal(/[\p{Script=Han}]/u.test(payload.error), locale === 'zh-CN');
    await page.getByRole('group', { name: locale === 'en-US' ? 'Interface language' : '界面语言' }).getByRole('button', { name: locale === 'en-US' ? '中文' : 'English', exact: true }).click();
    await page.reload();
    await page.getByRole('heading', { name: locale === 'en-US' ? '登录花卷' : 'Sign in to Huajuan', exact: true }).waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'), locale === 'en-US' ? 'zh-CN' : 'en-US');
    assert.match(await page.title(), locale === 'en-US' ? /花卷/ : /Huajuan/);
  });
});

test('英文覆盖所有设置与管理页面，保留中文用户内容，桌面和手机布局完整', { timeout: 240000 }, async () => {
  await mkdir(screenshots, { recursive: true });
  await withPage({ locale: 'en-US', colorScheme: 'light', reducedMotion: 'reduce' }, async (page, context) => {
    const filename = `保留中文用户文件-${Date.now()}.txt`;
    const upload = await context.request.post(`${base}/api/library/upload`, { multipart: { files: { name: filename, mimeType: 'text/plain', buffer: Buffer.from('user-authored content') } } });
    assert.equal(upload.status(), 200);
    const file = (await upload.json()).files[0];
    const library = await (await context.request.get(`${base}/api/library`)).json();
    const userNames = [...new Set([...library.files, ...library.folders].map(item => item.name))];
    try {
    const routes = ['/', '/admin', '/admin/skills', '/admin/media', '/admin/media/image', '/admin/media/audio', '/admin/users', ...['general', 'assistant', 'connections', 'browser', 'files', 'backups', 'permissions', 'usage'].map(section => `/settings?section=${section}`)];
    for (const route of routes) {
      await page.goto(base + route);
      await page.locator('main').first().waitFor();
      await page.waitForLoadState('networkidle');
      const han = await page.locator('body').innerText();
      const displaysFileNames = ['/settings?section=files', '/settings?section=usage'].includes(route);
      const interfaceText = displaysFileNames ? userNames.reduce((text, name) => text.replaceAll(name, ''), han) : han;
      assert.equal(/[\p{Script=Han}]/u.test(interfaceText.replaceAll('中文', '').replaceAll('花卷', '')), false, `${route}: ${han}`);
      if (route === '/settings?section=files') assert.ok(await page.getByText(filename, { exact: true }).count() > 0, '界面语言切换后保留用户的中文文件名');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), route);
    }
    await page.goto(base);
    const composer = page.getByRole('textbox', { name: 'Message', exact: true });
    await composer.fill('保留用户写下的中文内容');
    await page.getByRole('button', { name: 'Switch to 中文' }).click();
    assert.equal(await page.getByRole('textbox', { name: '消息', exact: true }).inputValue(), '保留用户写下的中文内容');
    await page.getByRole('heading', { name: '你想完成什么？' }).waitFor();
    await page.screenshot({ path: `${screenshots}/chat-zh-light.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '切换为 English' }).click();
    for (const route of ['/', '/admin', '/admin/media', '/settings?section=general']) {
      await page.goto(base + route);
      await page.waitForLoadState('networkidle');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `mobile ${route}`);
    }
    await page.screenshot({ path: `${screenshots}/settings-en-mobile.png` });
    } finally {
      assert.equal((await context.request.delete(`${base}/api/library`, { data: { fileIds: [file.fileId] } })).status(), 200);
    }
  }, true);
});

test('主题默认跟随系统，在所有页面实时切换，手选主题跨页保留', { timeout: 180000 }, async () => {
  await withPage({ locale: 'en-US', colorScheme: 'dark', reducedMotion: 'reduce' }, async (page, context) => {
    await context.request.put(`${base}/api/settings`, { data: { appearance: { themeMode: 'system' } } });
    for (const route of ['/', '/admin', '/settings?section=general', '/admin/media/audio']) {
      await page.goto(base + route);
      await page.waitForFunction(() => document.documentElement.classList.contains('dark-mode'));
      await page.emulateMedia({ colorScheme: 'light' });
      await page.waitForFunction(() => !document.documentElement.classList.contains('dark-mode'));
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'light');
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.waitForFunction(() => document.documentElement.classList.contains('dark-mode'));
    }
    await page.screenshot({ path: `${screenshots}/audio-en-dark.png` });
    await page.goto(`${base}/settings?section=general`);
    await page.getByLabel('Theme', { exact: true }).click();
    await page.getByRole('option', { name: 'Light', exact: true }).click();
    await page.getByRole('button', { name: 'Save appearance', exact: true }).click();
    await page.waitForFunction(() => !document.documentElement.classList.contains('dark-mode'));
    assert.equal(await page.evaluate(key => localStorage.getItem(key), themeKey), 'light');
    await page.goto(`${base}/admin`);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark-mode')), false);
    await page.goto(`${base}/settings?section=general`);
    await page.getByLabel('Theme', { exact: true }).click();
    await page.getByRole('option', { name: 'System', exact: true }).click();
    await page.getByRole('button', { name: 'Save appearance', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.classList.contains('dark-mode'));
    assert.equal(await page.locator('meta[name="theme-color"]').getAttribute('content'), '#111815');
    await context.request.put(`${base}/api/settings`, { data: { appearance: { themeMode: 'dark' } } });
    await page.evaluate(key => localStorage.removeItem(key), themeKey);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(`${base}/admin`);
    await page.waitForFunction(() => document.documentElement.classList.contains('dark-mode'));
    assert.equal(await page.evaluate(key => localStorage.getItem(key), themeKey), 'dark');
    await context.request.put(`${base}/api/settings`, { data: { appearance: { themeMode: 'system' } } });
  }, true);
});

test('减少动态效果时关闭循环动画和大幅移动，切换设置保持可操作', { timeout: 90000 }, async () => {
  await withPage({ locale: 'en-US', reducedMotion: 'reduce' }, async page => {
    await page.goto(`${base}/settings?section=general`);
    await page.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: 'Assistant', exact: true }).click();
    await page.getByRole('heading', { name: 'Assistant', exact: true }).waitFor();
    const durations = await page.evaluate(() => {
      const element = document.createElement('span');
      element.className = 'animate-spin';
      document.body.append(element);
      const style = getComputedStyle(element);
      const result = { duration: style.animationDuration, iterations: style.animationIterationCount, scroll: getComputedStyle(document.documentElement).scrollBehavior };
      element.remove();
      return result;
    });
    assert.ok(parseFloat(durations.duration) <= 0.001);
    assert.equal(durations.iterations, '1');
    assert.notEqual(durations.scroll, 'smooth');
  }, true);
});

test('登录表单正常提交，已显示的提示随语言切换', { timeout: 60000 }, async () => {
  await withPage({ locale: 'en-US', reducedMotion: 'reduce' }, async page => {
    await page.goto(base);
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill('admin@example.test');
    await page.getByLabel('Password', { exact: true }).fill('Vectaix-Test-2026!');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.locator('.toast-text').getByText('Signed in', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Switch to 中文' }).click();
    await page.locator('.toast-text').getByText('登录成功', { exact: true }).waitFor();
  });
});
