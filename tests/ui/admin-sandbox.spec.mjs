import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-chromium';

const base = 'http://localhost:3100';

for (const locale of ['zh-CN', 'en-US']) test(`管理员保存并测试云端沙盒（${locale}）`, { timeout: 90000 }, async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ locale, viewport: { width: locale === 'zh-CN' ? 1280 : 390, height: 900 }, colorScheme: locale === 'zh-CN' ? 'light' : 'dark', extraHTTPHeaders: { 'x-forwarded-for': locale === 'zh-CN' ? '192.0.2.191' : '192.0.2.192' } });
  try {
    assert.equal((await context.request.post(`${base}/api/auth/login`, { data: { email: 'admin@example.test', password: 'Vectaix-Test-2026!' } })).status(), 200);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let config = { enabled: false, environmentId: '', timeoutSeconds: 120, cpu: 1, memoryGB: 2, setupCommand: '', hasApiKey: false };
    let submitted;
    let tests = 0;
    await page.route('**/api/admin/sandbox', route => {
      if (route.request().method() === 'POST') { tests++; return route.fulfill({ json: { ok: true, output: 'Python: 2' } }); }
      if (route.request().method() === 'PUT') {
        submitted = route.request().postDataJSON();
        config = { enabled: submitted.enabled, environmentId: submitted.environmentId, timeoutSeconds: submitted.timeoutSeconds, cpu: submitted.cpu, memoryGB: submitted.memoryGB, setupCommand: submitted.setupCommand, hasApiKey: true };
      }
      return route.fulfill({ json: { config } });
    });
    await page.goto(`${base}/settings?section=admin&adminSection=sandbox`);
    const english = locale === 'en-US';
    await page.getByLabel(english ? 'Railway environment ID' : 'Railway 环境 ID', { exact: true }).fill('00000000-0000-4000-8000-000000000001');
    await page.getByLabel('Railway API Token', { exact: true }).fill('sandbox_test_ui_key');
    await page.getByLabel(english ? 'Enable cloud execution' : '启用云端执行', { exact: true }).check();
    const run = page.getByRole('button', { name: english ? 'Test Python execution' : '测试 Python 执行', exact: true });
    assert.equal(await run.isDisabled(), true);
    await page.getByRole('button', { name: english ? 'Save sandbox settings' : '保存沙盒设置', exact: true }).click();
    await page.getByRole('status').waitFor();
    assert.equal(submitted.enabled, true);
    assert.equal(submitted.environmentId, '00000000-0000-4000-8000-000000000001');
    assert.equal(submitted.apiKey, 'sandbox_test_ui_key');
    assert.equal(await page.getByLabel('Railway API Token', { exact: true }).inputValue(), '');
    await run.click();
    await page.getByText('Python: 2', { exact: true }).waitFor();
    assert.equal(tests, 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});
