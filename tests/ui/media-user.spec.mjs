import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-chromium';

const base = 'http://localhost:3100';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5X8AAAAASUVORK5CYII=', 'base64');
async function session(ip, run) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce', extraHTTPHeaders: { 'x-forwarded-for': ip } });
  try {
    assert.equal((await context.request.post(`${base}/api/auth/login`, { data: { email: 'member@example.test', password: 'Vectaix-Test-2026!' } })).status(), 200);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await run(page, context);
    assert.deepEqual(errors, []);
    assert.equal(await page.getByText('Application error:', { exact: false }).count(), 0);
  } finally { await context.close(); await browser.close(); }
}

test('普通用户从首页进入 Media，完成图片生成、刷新查看、删除并从文件设置返回', { timeout: 120000 }, async () => {
  await session('192.0.2.210', async page => {
    let images = [], generated;
    await page.route('**/api/media/capabilities', route => route.fulfill({ json: { image: true, fish: true, qwen: true, defaultAudioProvider: 'qwen' } }));
    await page.route('**/api/media/image/history', route => route.fulfill({ json: { images, nextCursor: null } }));
    await page.route('**/api/media/image/history/user-image', route => { images = []; return route.fulfill({ json: { success: true } }); });
    await page.route('**/api/media/image', route => {
      generated = route.request().postDataJSON();
      images = [{ fileId: 'user-image', url: '/api/files/user-image', name: 'image.png', createdAt: '2026-10-26T00:00:00Z' }];
      return route.fulfill({ json: { success: true, results: [{ success: true, fileId: 'user-image', url: '/api/files/user-image' }] } });
    });
    await page.route('**/api/files/user-image*', route => route.fulfill({ contentType: 'image/png', body: png }));
    await page.goto(base);
    await page.getByRole('link', { name: 'Media 创作', exact: true }).click();
    await page.getByRole('heading', { name: '把想法变成画面与声音', exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/media');
    assert.equal(await page.getByRole('link', { name: '管理后台', exact: true }).count(), 0);
    await page.screenshot({ path: '/tmp/huajuan-media-desktop.png' });
    await page.getByRole('link', { name: /图片创作/ }).click();
    await page.getByLabel('图片描述', { exact: true }).fill('一只绿色的花卷小助手');
    assert.equal(await page.getByRole('button', { name: '设为全平台默认参数', exact: true }).count(), 0);
    await page.getByRole('button', { name: '生成图片', exact: true }).last().click();
    await page.getByRole('region', { name: '图片记录', exact: true }).getByRole('button', { name: '删除图片', exact: true }).waitFor();
    assert.equal(generated.prompt, '一只绿色的花卷小助手');
    const liveHistory = page.getByRole('region', { name: '图片记录', exact: true });
    await liveHistory.getByRole('button', { name: '删除图片', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: '确认', exact: true }).click();
    await page.locator('img[src="/api/files/user-image"]').first().waitFor({ state: 'detached' });
    await page.getByRole('button', { name: '生成图片', exact: true }).last().click();
    await liveHistory.getByRole('button', { name: '删除图片', exact: true }).waitFor();
    await page.reload();
    const history = page.getByRole('region', { name: '图片记录', exact: true });
    await history.getByRole('button', { name: '删除图片', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: '确认', exact: true }).click();
    await history.getByRole('button', { name: '删除图片', exact: true }).waitFor({ state: 'detached' });
    await page.getByRole('link', { name: '我的文件', exact: true }).click();
    await page.getByRole('heading', { name: '文件', exact: true }).waitFor();
    await page.getByRole('link', { name: '返回 Media', exact: true }).click();
    await page.getByLabel('图片描述', { exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/media/image');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: '/tmp/huajuan-media-image-mobile.png' });
  });
});

test('普通用户的语音工作区可选 Qwen 和系统音色，且无全平台管理操作', { timeout: 120000 }, async () => {
  await session('192.0.2.211', async (page, context) => {
    await page.route('**/api/media/capabilities', route => route.fulfill({ json: { image: false, fish: false, qwen: true, defaultAudioProvider: 'qwen' } }));
    await page.goto(`${base}/media/audio`);
    await page.getByRole('button', { name: /^龙安欢/ }).waitFor();
    assert.equal(await page.getByLabel('语音模型', { exact: true }).inputValue(), 'qwen');
    await page.getByRole('button', { name: /^龙安欢/ }).click();
    await page.getByLabel('配音文本', { exact: true }).fill('这是我的配音');
    assert.equal(await page.getByRole('button', { name: '生成语音', exact: true }).isEnabled(), true);
    assert.equal(await page.getByRole('button', { name: '设为全平台默认参数', exact: true }).count(), 0);
    assert.equal((await context.request.get(`${base}/api/media/audio/qwen/voices`)).status(), 200);
    assert.equal((await context.request.get(`${base}/api/media/audio/fish/generations`)).status(), 200);
    assert.equal((await context.request.get(`${base}/api/admin/media`)).status(), 403);
    await page.getByLabel('语音模型', { exact: true }).selectOption('fish');
    await page.getByText('这项服务尚未开通。', { exact: false }).waitFor();
    assert.equal(await page.getByRole('button', { name: '生成语音', exact: true }).isDisabled(), true);
    await page.getByRole('tab', { name: '声音复刻', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '创建音色', exact: true }).isDisabled(), true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'dark' });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: '/tmp/huajuan-media-audio-mobile.png' });
  });
});

test('Media 深链接要求登录，普通用户进入后台会返回前台', { timeout: 120000 }, async () => {
  const browser = await chromium.launch();
  try {
    const anonymous = await browser.newContext();
    const page = await anonymous.newPage();
    await page.goto(`${base}/media/audio`);
    assert.equal(new URL(page.url()).pathname, '/');
    await page.getByRole('heading', { name: '登录花卷', exact: true }).waitFor();
    await anonymous.close();
    await session('192.0.2.212', async member => {
      await member.goto(`${base}/admin/media`);
      assert.equal(new URL(member.url()).pathname, '/');
      await member.getByRole('link', { name: 'Media 创作', exact: true }).waitFor();
    });
  } finally { await browser.close(); }
});
