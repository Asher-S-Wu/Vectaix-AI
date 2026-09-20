import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-chromium';

const base = 'http://localhost:3100';
const image = '<svg xmlns="http://www.w3.org/2000/svg" width="768" height="512"><rect width="768" height="512" fill="#b6d9ee"/><circle cx="590" cy="120" r="55" fill="#f7d58b"/><path d="M0 512V380L220 140L450 390L610 210L768 400V512" fill="#3f776e"/></svg>';

async function withPage(run, ip) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { 'x-forwarded-for': ip } });
  try {
    const login = await context.request.post(`${base}/api/auth/login`, { data: { email: 'member@example.test', password: 'Vectaix-Test-2026!' } });
    assert.equal(login.status(), 200);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await run(page, context);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
    await browser.close();
  }
}

test('图片页传递 1～4 张数量，等待整组完成并展示成功与失败位置', { timeout: 90000 }, async () => {
  await withPage(async (page, context) => {
    let release, submitted;
    await page.route('**/api/files/ui-image-*', route => route.fulfill({ contentType: 'image/svg+xml', body: image }));
    await page.route('**/api/media/image', async route => {
      submitted = route.request().postDataJSON();
      await new Promise(resolve => { release = resolve; });
      await route.fulfill({ json: { success: true, results: Array.from({ length: submitted.count }, (_, index) => submitted.count === 4 && index === 1
        ? { success: false, message: '测试图片未通过审核' }
        : { success: true, fileId: `ui-image-${index}`, url: `/api/files/ui-image-${index}` }) } });
    });
    await page.goto(`${base}/media/image`);
    await page.getByLabel('图片描述').fill('风景');
    assert.equal(await page.locator('select').count(), 0);
    for (const count of [1, 2, 3, 4]) {
      await page.getByLabel('图片数量', { exact: true }).click();
      await page.getByRole('option', { name: `${count} 张`, exact: true }).click();
      const dispatched = page.waitForRequest(request => request.url().endsWith('/api/media/image') && request.method() === 'POST');
      await page.locator('button[type="submit"]').click();
      await dispatched;
      await page.locator('[aria-busy="true"]').waitFor();
      assert.equal(submitted.count, count);
      assert.equal(await page.locator('[aria-busy="true"] > div').count(), count);
      assert.equal(await page.getByLabel('图片数量', { exact: true }).isDisabled(), true);
      assert.equal(await page.getByRole('link', { name: '下载', exact: true }).count(), 0);
      release();
      await page.locator('[aria-busy="false"]').waitFor();
      assert.equal(await page.getByRole('link', { name: '下载', exact: true }).count(), count === 4 ? 3 : count);
    }
    await page.getByText('测试图片未通过审核', { exact: true }).waitFor();
    await page.getByRole('button', { name: '放大', exact: true }).first().click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '用于对话创作', exact: true }).click();
    await page.getByText('对话创作已使用当前配置', { exact: true }).waitFor();
    assert.equal((await (await context.request.get(`${base}/api/settings`)).json()).settings.chatMediaSettings.image.count, 4);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    const cards = await page.locator('[aria-busy="false"] > div').evaluateAll(items => items.map(item => item.getBoundingClientRect().x));
    assert.ok(cards.every(x => x === cards[0]));
  }, '192.0.2.210');
});

test('本站菜单支持键盘、表单保存、数字选项和原生弹窗内必选校验', { timeout: 90000 }, async () => {
  await withPage(async (page, context) => {
    await context.request.put(`${base}/api/settings`, { data: { appearance: { themeMode: 'system', fontSize: 'medium', completionSoundVolume: 50 } } });
    await page.goto(`${base}/settings?section=general`);
    const theme = page.locator('input[name="themeMode"]').locator('xpath=following-sibling::button[1]');
    await theme.focus();
    await page.keyboard.press('ArrowDown');
    await page.getByRole('option').first().waitFor();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('input[name="themeMode"]').inputValue(), 'dark');
    await page.getByRole('button', { name: '保存外观', exact: true }).click();
    await page.getByText('已保存', { exact: true }).waitFor();
    assert.equal((await (await context.request.get(`${base}/api/settings`)).json()).settings.appearance.themeMode, 'dark');
    await theme.click();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('listbox').count(), 0);
    assert.equal(await theme.evaluate(element => element === document.activeElement), true);
    await theme.click();
    await page.keyboard.press('Tab');
    assert.equal(await page.getByRole('listbox').count(), 0);

    const name = `菜单验收-${Date.now()}`;
    const projectResponse = await context.request.post(`${base}/api/projects`, { data: { name } });
    assert.equal(projectResponse.status(), 201);
    await page.goto(`${base}/settings?section=files`);
    await page.locator('input[type="file"]').setInputFiles({ name: `${name}.txt`, mimeType: 'text/plain', buffer: Buffer.from('test file') });
    await page.getByRole('checkbox', { name: `选择 ${name}.txt`, exact: true }).check();
    await page.getByRole('button', { name: '复制到项目', exact: true }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.waitFor();
    assert.equal(await dialog.getByRole('button', { name: '保存', exact: true }).isDisabled(), true);
    await dialog.locator('form').evaluate(form => form.requestSubmit());
    await page.getByRole('listbox').waitFor();
    assert.equal(await page.locator('dialog [role="listbox"]').count(), 1);
    await page.getByRole('option', { name, exact: true }).click();
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.goto(`${base}/settings?section=backups`);
    await page.getByLabel('备份周期', { exact: true }).click();
    await page.getByRole('option', { name: '每周', exact: true }).click();
    await page.getByLabel('星期', { exact: true }).click();
    await page.getByRole('option', { name: '星期三', exact: true }).click();
    assert.equal(await page.getByLabel('星期', { exact: true }).textContent(), '星期三');
    assert.equal(await page.locator('select').count(), 0);
  }, '192.0.2.211');
});
