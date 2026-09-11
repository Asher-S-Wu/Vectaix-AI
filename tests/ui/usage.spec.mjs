import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-chromium';

const base = 'http://localhost:3100';

test('usage logs endpoint and settings page return data instead of an HTML 404', { timeout: 90000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  try {
    const anonymous = await context.request.get(`${base}/api/usage/logs`);
    assert.equal(anonymous.status(), 401);
    assert.equal((await anonymous.json()).error, '请先登录');

    const login = await context.request.post(`${base}/api/auth/login`, {
      data: { email: 'member@example.test', password: 'Vectaix-Test-2026!' },
    });
    assert.equal(login.status(), 200);
    const logs = await context.request.get(`${base}/api/usage/logs`);
    assert.equal(logs.status(), 200);
    assert.ok(Array.isArray((await logs.json()).events));
    const filtered = await context.request.get(`${base}/api/usage/logs?start=2026-01-01&end=2026-01-02&model=test-model`);
    assert.equal(filtered.status(), 200);
    assert.ok(Array.isArray((await filtered.json()).events));
    const invalid = await context.request.get(`${base}/api/usage/logs?start=invalid`);
    assert.equal(invalid.status(), 400);
    assert.equal((await invalid.json()).error, '请选择有效日期');

    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/settings?section=usage`);
    await page.getByText('所选范围花费', { exact: true }).waitFor();
    await page.getByRole('heading', { name: /存储空间/ }).waitFor();
    assert.equal(await page.getByRole('alert').filter({ hasText: /\S/ }).count(), 0);
    await page.getByLabel('账单月份').fill('2026-08');
    const queried = page.waitForResponse(response => response.url().includes('/api/usage/logs?'));
    await page.getByRole('button', { name: '查询', exact: true }).click();
    assert.equal((await queried).status(), 200);
    const usage = await context.request.get(`${base}/api/usage?month=2026-08`);
    const payload = await usage.json();
    assert.equal(payload.range.month, '2026-08');
    assert.equal(typeof payload.summary.costCny, 'number');
    assert.ok(Array.isArray(payload.monthly));
    assert.equal(await page.getByText('积分与费率', { exact: true }).count(), 0);
    const adminLogin = await context.request.post(`${base}/api/auth/login`, {data:{email:'admin@example.test',password:'Vectaix-Test-2026!'}});
    assert.equal(adminLogin.status(),200);
    await page.goto(`${base}/settings?section=usage`);
    await page.getByRole('button',{name:'用户管理 管理',exact:true}).waitFor();
    assert.equal(await page.getByText('模型管理',{exact:true}).count(),0);
    assert.equal(await page.getByText('积分与费率',{exact:true}).count(),0);
    for(const route of ['models','providers','billing-settings']) {
      assert.equal((await context.request.get(`${base}/api/admin/${route}`)).status(),404);
    }
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
    await browser.close();
  }
});
