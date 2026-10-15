import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-chromium';

const base = 'http://localhost:3100';
const firstId = '000000000000000000000001';
const secondId = '000000000000000000000002';
const model = { id: 'test-chat', name: '测试对话模型', provider: 'openai', group: '测试', nativeInputs: ['text', 'image'] };
const conversations = [
  { _id: firstId, title: '第一段对话', model: model.id, messages: [{ id: 'first-message', role: 'user', content: '第一段内容' }] },
  { _id: secondId, title: '第二段对话', model: model.id, messages: [{ id: 'second-message', role: 'user', content: '第二段内容' }] },
];

async function withChat(run, ip = '192.0.2.250', beforeLoad) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { 'x-forwarded-for': ip } });
  try {
    assert.equal((await context.request.post(`${base}/api/auth/login`, { data: { email: 'member@example.test', password: 'Vectaix-Test-2026!' } })).status(), 200);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/models', route => route.fulfill({ json: { models: [model], defaultModelId: model.id } }));
    await page.route('**/api/conversations', route => route.fulfill({ json: { conversations } }));
    await page.route('**/api/conversations/*', route => route.fulfill({ json: { conversation: conversations.find(item => route.request().url().endsWith(item._id)) } }));
    await page.route('**/api/tasks?*', route => route.fulfill({ json: { tasks: [] } }));
    if (beforeLoad) await beforeLoad(page);
    await page.goto(base);
    await page.getByRole('button', { name: '选择模型', exact: true }).filter({ hasText: model.name }).waitFor();
    await run(page);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
    await browser.close();
  }
}

test('连续切换对话只显示最后选择的内容，并清理上一段对话的编辑框', { timeout: 90000 }, async () => {
  await withChat(async page => {
    let release;
    const held = new Promise(resolve => { release = resolve; });
    await page.route(`**/api/conversations/${firstId}`, async route => {
      await held;
      await route.fulfill({ json: { conversation: conversations[0] } });
    });
    const firstRequest = page.waitForRequest(`**/api/conversations/${firstId}`);
    await page.getByRole('button', { name: '第一段对话', exact: true }).click({ position: { x: 20, y: 20 } });
    await firstRequest;
    await page.getByRole('button', { name: '第二段对话', exact: true }).click({ position: { x: 20, y: 20 } });
    await page.getByText('第二段内容', { exact: true }).waitFor();
    release();
    await page.unroute(`**/api/conversations/${firstId}`);
    await page.waitForFunction(() => document.querySelector('button[aria-current="page"]')?.textContent.includes('第二段对话'));
    assert.equal(await page.getByText('第一段内容', { exact: true }).count(), 0);

    await page.getByRole('button', { name: '第一段对话', exact: true }).click({ position: { x: 20, y: 20 } });
    await page.getByText('第一段内容', { exact: true }).waitFor();
    await page.getByRole('button', { name: '编辑消息', exact: true }).click();
    await page.getByRole('button', { name: '提交', exact: true }).waitFor();
    await page.getByRole('button', { name: '第二段对话', exact: true }).click({ position: { x: 20, y: 20 } });
    await page.getByText('第二段内容', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '提交', exact: true }).count(), 0);
    assert.equal(await page.locator('textarea').count(), 1);
  });
});

test('首次恢复历史期间等待读取完成，再向恢复的对话发送消息', { timeout: 90000 }, async () => {
  let release, observed;
  const held = new Promise(resolve => { release = resolve; });
  const requested = new Promise(resolve => { observed = resolve; });
  let submitted = 0;
  await withChat(async page => {
    await requested;
    await page.route('**/api/tasks', async route => {
      submitted += 1;
      assert.equal(route.request().postDataJSON().conversationId, firstId);
      await route.fulfill({ status: 400, json: { error: '发送已到达恢复的对话' } });
    });
    const input = page.getByPlaceholder('给 AI 发送消息…');
    await input.fill('恢复完成后发送');
    await input.press('Enter');
    assert.equal(submitted, 0);
    release();
    await page.getByText('第一段内容', { exact: true }).waitFor();
    await input.press('Enter');
    await page.getByText('发送已到达恢复的对话', { exact: true }).waitFor();
    assert.equal(submitted, 1);
  }, '192.0.2.253', async page => {
    await page.addInitScript(id => window.localStorage.setItem('vectaix-current-conversation', id), firstId);
    await page.route(`**/api/conversations/${firstId}`, async route => {
      observed();
      await held;
      await route.fulfill({ json: { conversation: conversations[0] } });
    });
  });
});

test('编辑图片提交途中切换对话，保留正在交给任务的附件', { timeout: 90000 }, async () => {
  await withChat(async page => {
    const fileId = 'edited-image';
    let release;
    const held = new Promise(resolve => { release = resolve; });
    let deleted = 0;
    await page.route('**/api/upload', route => route.fulfill({ json: { fileId, url: `/api/files/${fileId}`, mimeType: 'image/png' } }));
    await page.route(`**/api/files/${fileId}`, route => {
      if (route.request().method() === 'DELETE') deleted += 1;
      return route.fulfill({ json: { success: true } });
    });
    await page.route('**/api/tasks', async route => {
      assert.deepEqual(route.request().postDataJSON().attachments, [{ fileId }]);
      await held;
      await route.fulfill({ json: { conversation: conversations[0], task: { _id: 'edit-task', conversationId: firstId, status: 'completed' } } });
    });
    await page.getByRole('button', { name: '第一段对话', exact: true }).click({ position: { x: 20, y: 20 } });
    await page.getByText('第一段内容', { exact: true }).waitFor();
    await page.getByRole('button', { name: '编辑消息', exact: true }).click();
    await page.locator('input[type="file"]').first().setInputFiles({ name: '参考.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVMcAAAAASUVORK5CYII=', 'base64') });
    await page.getByRole('button', { name: '提交', exact: true }).waitFor();
    const sent = page.waitForRequest(request => request.url().endsWith('/api/tasks') && request.method() === 'POST');
    await page.getByRole('button', { name: '提交', exact: true }).click();
    await sent;
    await page.getByRole('button', { name: '第二段对话', exact: true }).click({ position: { x: 20, y: 20 } });
    await page.getByText('第二段内容', { exact: true }).waitFor();
    assert.equal(deleted, 0);
    release();
  }, '192.0.2.254');
});

test('中文选词回车保留输入，发送途中新建对话后旧响应不会重新打开对话', { timeout: 90000 }, async () => {
  await withChat(async page => {
    let release;
    const held = new Promise(resolve => { release = resolve; });
    let submitted = 0;
    await page.route('**/api/tasks', async route => {
      submitted += 1;
      const { prompt } = route.request().postDataJSON();
      await held;
      await route.fulfill({ json: {
        conversation: { _id: firstId, messages: [{ id: 'sent-message', role: 'user', content: prompt }] },
        task: { _id: 'test-task', conversationId: firstId, status: 'completed' },
      } });
    });
    const input = page.getByPlaceholder('给 AI 发送消息…');
    await input.fill('正在输入中文');
    const accepted = await input.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })));
    assert.equal(accepted, true, '选词回车应继续交给输入法处理');
    assert.equal(submitted, 0);
    assert.equal(await input.inputValue(), '正在输入中文');

    const requested = page.waitForRequest(request => request.url().endsWith('/api/tasks') && request.method() === 'POST');
    await input.press('Enter');
    await requested;
    await page.getByRole('button', { name: '新建对话', exact: true }).first().click();
    release();
    await page.waitForFunction(() => document.querySelector('textarea')?.value === '');
    await page.getByRole('heading', { name: '今天能帮你做点什么？', exact: true }).waitFor();
    assert.equal(await page.locator('button[aria-current="page"]').count(), 0);
    assert.equal(await page.getByText('正在输入中文', { exact: true }).count(), 0);
    assert.equal(submitted, 1);
  });
});

test('登录网络失败给出提示，退出请求失败时保留当前会话', { timeout: 90000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/auth/login', route => route.abort('failed'));
    await page.goto(base);
    await page.getByPlaceholder('邮箱', { exact: true }).fill('member@example.test');
    await page.getByPlaceholder('密码', { exact: true }).fill('Vectaix-Test-2026!');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByText(/登录失败：/).waitFor();
    assert.equal(await page.getByRole('button', { name: '登录', exact: true }).isEnabled(), true);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }

  await withChat(async page => {
    await page.route('**/api/auth/me', route => route.request().method() === 'DELETE'
      ? route.fulfill({ status: 503, json: { error: '退出服务暂时不可用' } })
      : route.continue());
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await page.getByText('退出失败：退出服务暂时不可用', { exact: true }).waitFor();
    assert.equal(await page.getByPlaceholder('邮箱', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '退出登录', exact: true }).count(), 1);
  }, '192.0.2.252');
});
