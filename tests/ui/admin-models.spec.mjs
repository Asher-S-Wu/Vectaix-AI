import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-chromium';

const base = 'http://localhost:3100';

test('管理员填入连接后自动获取模型，切换地址取消旧结果并保存全局设置', { timeout: 90000 }, async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { 'x-forwarded-for': '192.0.2.198' } });
  let release;
  const held = new Promise(resolve => { release = resolve; });
  try {
    assert.equal((await context.request.post(`${base}/api/auth/login`, { data: { email: 'admin@example.test', password: 'Vectaix-Test-2026!' } })).status(), 200);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let config = { baseUrl: '', protocol: 'responses', modelId: '', displayName: '花卷助手', contextWindow: 128000, maxOutputTokens: 8192, nativeInputs: ['text', 'image'], supportsTools: true, pricing: { inputPerMillion: 0, cachedInputPerMillion: 0, outputPerMillion: 0 }, hasApiKey: false };
    let submitted;
    await page.route('**/api/admin/models', route => {
      if (route.request().method() === 'PUT') { submitted = route.request().postDataJSON(); const { apiKey: _key, ...values } = submitted; config = { ...values, hasApiKey: true }; }
      return route.fulfill({ json: { config } });
    });
    const discovered = [];
    await page.route('**/api/admin/models/discover', async route => {
      const input = route.request().postDataJSON(); discovered.push(input);
      if (input.baseUrl.includes('first.example')) await held;
      await route.fulfill({ json: { models: [{ id: input.baseUrl.includes('first.example') ? 'old-model' : 'new-model', name: input.baseUrl.includes('first.example') ? '旧模型' : '新模型' }] } });
    });
    await page.goto(`${base}/admin`);
    await page.getByLabel('API 地址', { exact: true }).fill('https://first.example/v1');
    await page.getByLabel('API Key', { exact: true }).fill('ui-test-key');
    await page.waitForRequest('**/api/admin/models/discover');
    await page.getByLabel('API 地址', { exact: true }).fill('https://second.example/v1');
    await page.getByRole('option', { name: '新模型', exact: true }).waitFor({ state: 'attached' });
    release();
    await page.getByLabel('模型', { exact: true }).selectOption('new-model');
    await page.getByRole('button', { name: '保存模型设置', exact: true }).click();
    await page.getByText('模型服务已保存，所有用户的新任务将使用此配置。', { exact: true }).waitFor();
    assert.equal(submitted.baseUrl, 'https://second.example/v1');
    assert.equal(submitted.modelId, 'new-model');
    assert.equal(submitted.apiKey, 'ui-test-key');
    assert.equal(await page.getByLabel('API Key', { exact: true }).inputValue(), '');
    assert.equal(await page.getByRole('option', { name: '旧模型', exact: true }).count(), 0);
    assert.ok(discovered.length >= 2);
    assert.deepEqual(errors, []);
  } finally { release(); await context.close(); await browser.close(); }
});
