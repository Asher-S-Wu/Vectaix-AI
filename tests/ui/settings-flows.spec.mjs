import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-chromium';

const base = 'http://localhost:3100';

async function withPage(run, ip) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { 'x-forwarded-for': ip } });
  try {
    assert.equal((await context.request.post(`${base}/api/auth/login`, { data: { email: 'admin@example.test', password: 'Vectaix-Test-2026!' } })).status(), 200);
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await run(page, context);
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
}

test('默认头像按账号固定分配，上传图片后保留自定义头像，移除后恢复原头像', { timeout: 45000 }, async () => {
  await withPage(async (page, context) => {
    const registration = await context.request.post(`${base}/api/auth/register`, { data: { email: `avatar-${Date.now()}@example.test`, password: 'Vectaix-Test-2026!', confirmPassword: 'Vectaix-Test-2026!' } });
    assert.equal(registration.status(), 200);
    const settings = (await (await context.request.get(`${base}/api/settings`)).json()).settings;
    const defaultAvatar = settings.avatar;
    assert.match(defaultAvatar, /^\/avatars\/[a-z]+\.svg$/);
    const asset = await context.request.get(`${base}${defaultAvatar}`);
    assert.equal(asset.status(), 200);
    assert.match(asset.headers()['content-type'], /image\/svg\+xml/);
    const saved = await context.request.put(`${base}/api/settings`, { data: { nickname: settings.nickname } });
    assert.equal(saved.status(), 200);
    assert.equal((await saved.json()).settings.avatar, defaultAvatar);
    const repeated = await Promise.all(Array.from({ length: 3 }, async () => (await (await context.request.get(`${base}/api/settings`)).json()).settings.avatar));
    assert.deepEqual(repeated, Array(3).fill(defaultAvatar));

    await page.goto(base);
    const sidebarAvatar = page.getByRole('button', { name: '设置', exact: true }).locator('img');
    await sidebarAvatar.waitFor();
    assert.equal(await sidebarAvatar.getAttribute('src'), defaultAvatar);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const profileAvatar = page.getByRole('img', { name: '我的头像', exact: true });
    await profileAvatar.waitFor();
    assert.equal(await profileAvatar.getAttribute('src'), defaultAvatar);
    await page.getByLabel('头像', { exact: true }).setInputFiles({ name: '头像.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVMcAAAAASUVORK5CYII=', 'base64') });
    await page.getByText('头像已更新', { exact: true }).waitFor();
    const customAvatar = (await (await context.request.get(`${base}/api/settings`)).json()).settings.avatar;
    assert.match(customAvatar, /^\/api\/files\//);
    assert.equal(await profileAvatar.getAttribute('src'), customAvatar);
    await page.reload();
    await profileAvatar.waitFor();
    assert.equal(await profileAvatar.getAttribute('src'), customAvatar);
    await page.getByRole('button', { name: '恢复默认头像', exact: true }).click();
    await page.getByText('已恢复默认头像', { exact: true }).waitFor();
    assert.equal(await profileAvatar.getAttribute('src'), defaultAvatar);
    assert.equal((await context.request.get(`${base}${customAvatar}`)).status(), 404);
    await page.getByRole('link', { name: '返回对话', exact: true }).click();
    await sidebarAvatar.waitFor();
    assert.equal(await sidebarAvatar.getAttribute('src'), defaultAvatar);
    await page.reload();
    await sidebarAvatar.waitFor();
    assert.equal(await sidebarAvatar.getAttribute('src'), defaultAvatar);
  }, '192.0.2.228');
});

test('备份选择远端连接后提交该连接，并要求填写目标文件夹', { timeout: 45000 }, async () => {
  await withPage(async page => {
    let submitted;
    await page.route('**/api/connections', route => route.fulfill({ json: { connections: [{ id: '507f1f77bcf86cd799439011', name: '远端资料库', kind: 'webdav', enabled: true, config: { url: 'https://example.test/dav' }, tools: [], resources: [], prompts: [] }] } }));
    await page.route('**/api/backups', route => {
      if (route.request().method() === 'POST') submitted = route.request().postDataJSON();
      return route.fulfill({ json: { jobs: [] } });
    });
    await page.route('**/api/backups/schedules', route => route.fulfill({ json: { schedules: [] } }));
    const connectionsLoaded = page.waitForResponse('**/api/connections');
    await page.goto(`${base}/settings?section=backups`);
    await connectionsLoaded;
    await page.getByLabel('备份密码', { exact: true }).fill('long-test-password');
    await page.getByLabel('备份保存位置', { exact: true }).click();
    await page.getByRole('option', { name: '远端资料库', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '立即备份', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: '添加定时备份', exact: true }).isDisabled(), true);
    await page.getByLabel('远端文件夹', { exact: true }).fill('backups');
    await page.getByRole('button', { name: '立即备份', exact: true }).click();
    await page.getByRole('status').waitFor();
    assert.deepEqual(submitted.destination, { connectionId: '507f1f77bcf86cd799439011', path: 'backups' });
  }, '192.0.2.221');
});

test('模板弹窗支持键盘应用模板，保存期间阻止重复创建', { timeout: 45000 }, async () => {
  await withPage(async page => {
    let release = () => {};
    let creates = 0;
    const settings = { nickname: '', avatar: null, avatarFileId: null, chatSystemPrompt: '原指令', systemPrompts: [{ _id: '507f1f77bcf86cd799439012', name: '精简回复', content: '先说结论' }], assistant: { name: '花卷', language: 'auto', style: '', instructions: '', avatarFileId: null }, appearance: { themeMode: 'system', fontSize: 'medium', completionSoundVolume: 50 }, permissions: { notifications: false, browser: false, externalTools: false } };
    await page.route('**/api/settings', async route => {
      if (route.request().method() === 'POST') { creates++; await new Promise(resolve => { release = resolve; }); }
      await route.fulfill({ json: { settings } });
    });
    try {
    const settingsLoaded = page.waitForResponse('**/api/settings');
    await page.goto(`${base}/settings?section=general`);
    await settingsLoaded;
    await page.getByRole('button', { name: '管理指令模板', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '对话指令与模板', exact: true });
    await dialog.waitFor();
    await page.setViewportSize({ width: 844, height: 390 });
    const bounds = await dialog.locator('[tabindex="-1"]').boundingBox();
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 390);
    await page.setViewportSize({ width: 1280, height: 900 });
    const preset = dialog.getByRole('button', { name: '应用模板：精简回复', exact: true });
    await preset.focus();
    await page.keyboard.press('Enter');
    assert.equal(await dialog.getByLabel('后续对话使用的指令').inputValue(), '先说结论');
    await dialog.getByRole('button', { name: '存为新模板', exact: true }).click();
    const creating = page.waitForRequest(request => request.url().endsWith('/api/settings') && request.method() === 'POST');
    await dialog.getByRole('button', { name: '保存模板', exact: true }).click();
    await creating;
    assert.equal(await dialog.getByRole('button', { name: '保存模板', exact: true }).isDisabled(), true);
    release();
    await dialog.getByRole('button', { name: '存为新模板', exact: true }).waitFor();
    assert.equal(creates, 1);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    } finally { release(); }
  }, '192.0.2.222');
});

test('助手设置加载失败可手动重试，恢复后正常显示表单', { timeout: 45000 }, async () => {
  await withPage(async page => {
    let failing = true;
    await page.route('**/api/settings', route => {
      return failing ? route.fulfill({ status: 503, json: { error: '设置读取失败，请重试' } }) : route.fulfill({ json: { settings: { assistant: { name: '我的助手', language: 'auto', style: '', instructions: '', avatarFileId: null } } } });
    });
    await page.goto(`${base}/settings?section=assistant`);
    await page.getByRole('alert').filter({ hasText: '设置读取失败' }).waitFor();
    failing = false;
    await page.getByRole('button', { name: '重新加载', exact: true }).click();
    assert.equal(await page.getByLabel('助手名称', { exact: true }).inputValue(), '我的助手');
    assert.equal(await page.getByRole('alert').filter({ hasText: '设置读取失败' }).count(), 0);
  }, '192.0.2.223');
});

test('诊断下载沿用已经查询的筛选条件，任务按钮直接加载该任务记录', { timeout: 45000 }, async () => {
  await withPage(async page => {
    const taskId = '507f1f77bcf86cd799439013';
    const month = '2026-08';
    const fixture = { range: { month }, summary: { costCny: 1, requests: 1, unpricedRequests: 0 }, currentMonth: { month: '2026-10', costCny: 1, unpricedRequests: 0 }, monthly: [], daily: [], tasks: [{ _id: taskId, status: 'completed', costCny: 1, createdAt: '2026-08-01T00:00:00Z' }] };
    await page.route('**/api/usage{,?*}', route => route.fulfill({ json: fixture }));
    await page.route('**/api/usage/logs{,?*}', route => route.fulfill({ json: { events: [{ id: 'event-1', type: 'agent_start', createdAt: '2026-08-01T00:00:00Z' }, { id: 'event-2', type: 'tool_result', tool: 'update_plan', status: 'done', createdAt: '2026-08-01T00:00:01Z' }] } }));
    await page.route('**/api/usage/storage', route => route.fulfill({ json: { totalBytes: 0, categories: [], backups: { count: 0, bytes: 0 }, cleanupCandidates: [] } }));
    await page.goto(`${base}/settings?section=usage`);
    await page.getByText('子助手开始调查', { exact: true }).waitFor();
    const diagnostics = page.getByRole('link', { name: '下载诊断记录', exact: true });
    const initialHref = await diagnostics.getAttribute('href');
    await page.getByLabel('账单月份', { exact: true }).fill(month);
    assert.equal(await diagnostics.getAttribute('href'), initialHref);
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('a[href^="/api/usage/diagnostics?"]').getAttribute('href') === '/api/usage/diagnostics?month=2026-08');
    await page.getByText('任务花费（最多 200 条）', { exact: true }).click();
    const queried = page.waitForRequest(request => request.url().includes(`/api/usage/logs?month=${month}&taskId=${taskId}`));
    await page.getByRole('button').filter({ hasText: taskId }).click();
    await queried;
    await page.waitForFunction(id => document.querySelector('a[href^="/api/usage/diagnostics?"]').getAttribute('href').includes(`taskId=${id}`), taskId);
  }, '192.0.2.224');
});

test('用户管理弹窗可用键盘关闭，删除末页最后一位用户后返回前一页', { timeout: 45000 }, async () => {
  await withPage(async page => {
    let deleted = false;
    const lastUserId = '507f1f77bcf86cd799439014';
    const user = (id, email) => ({ id, email, isAdmin: false, createdAt: '2026-08-01T00:00:00Z', conversationCount: 0, lifetimeCostCny: 0 });
    await page.route('**/api/admin/users?*', route => {
      const current = Number(new URL(route.request().url()).searchParams.get('page'));
      return route.fulfill({ json: { users: current === 2 && !deleted ? [user(lastUserId, 'last@example.test')] : [user('507f1f77bcf86cd799439015', 'first@example.test')], total: deleted ? 20 : 21, page: current, totalPages: deleted ? 1 : 2 } });
    });
    await page.route(`**/api/admin/users/${lastUserId}`, route => { deleted = true; return route.fulfill({ json: { success: true } }); });
    await page.goto(`${base}/settings?section=admin&adminSection=users`);
    const opener = page.getByRole('button', { name: '管理用户', exact: true });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: '用户管理', exact: true });
    await dialog.getByRole('button', { name: '下一页', exact: true }).click();
    await dialog.getByText('last@example.test', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: '删除用户', exact: true }).click();
    await page.getByRole('alertdialog', { name: '删除用户', exact: true }).getByRole('button', { name: '删除', exact: true }).click();
    await dialog.getByText('first@example.test', { exact: true }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: '下一页', exact: true }).count(), 0);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await opener.evaluate(element => element === document.activeElement), true);
  }, '192.0.2.225');
});

test('模型密钥可以明确清除，停用状态与保存结果保持一致', { timeout: 45000 }, async () => {
  await withPage(async page => {
    let submitted;
    let config = { baseUrl: 'https://models.example.test/v1', protocol: 'responses', modelId: 'example-model', displayName: '测试模型', contextWindow: 128000, maxOutputTokens: 8192, nativeInputs: ['text', 'image'], supportsTools: true, pricing: { inputPerMillion: 1, cachedInputPerMillion: 0, outputPerMillion: 2 }, hasApiKey: true };
    await page.route('**/api/admin/models', route => {
      if (route.request().method() === 'PUT') { submitted = route.request().postDataJSON(); config = { ...config, hasApiKey: false }; }
      return route.fulfill({ json: { config } });
    });
    await page.route('**/api/admin/models/discover', route => route.fulfill({ json: { models: [] } }));
    await page.goto(`${base}/settings?section=admin`);
    await page.locator('summary').filter({ hasText: '服务连接' }).click();
    await page.getByLabel('保存时删除密钥并停用模型服务', { exact: true }).check();
    assert.equal(await page.getByLabel('API Key', { exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: '保存模型设置', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '填写 API Key' }).waitFor();
    assert.equal(submitted.clearApiKey, true);
    assert.equal(submitted.apiKey, undefined);
    await page.getByText('尚未配置 API Key，当前模型服务未启用。', { exact: true }).waitFor();
  }, '192.0.2.226');
});

test('手动获取模型会取消自动发现计时，随后仍可保存', { timeout: 45000 }, async () => {
  await withPage(async page => {
    await page.clock.install();
    const config = { baseUrl: 'https://models.example.test/v1', protocol: 'responses', modelId: 'example-model', displayName: '测试模型', contextWindow: 128000, maxOutputTokens: 8192, nativeInputs: ['text', 'image'], supportsTools: true, pricing: { inputPerMillion: 1, cachedInputPerMillion: 0, outputPerMillion: 2 }, hasApiKey: true };
    await page.route('**/api/admin/models', route => route.fulfill({ json: { config } }));
    await page.route('**/api/admin/models/discover', route => route.fulfill({ json: { models: [{ id: 'example-model', name: '测试模型' }] } }));
    await page.goto(`${base}/settings?section=admin`);
    await page.locator('summary').filter({ hasText: '服务连接' }).click();
    await page.getByRole('button', { name: '获取模型列表', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '已获取 1 个模型' }).waitFor();
    await page.clock.runFor(1200);
    assert.equal(await page.getByRole('button', { name: '保存模型设置', exact: true }).isDisabled(), false);
  }, '192.0.2.227');
});
