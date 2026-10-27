import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-chromium';

const base = 'http://localhost:3100';
const firstId = '000000000000000000000001';
const secondId = '000000000000000000000002';
const imageBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVMcAAAAASUVORK5CYII=', 'base64');
const imageFile = { name: '参考图片.png', mimeType: 'image/png', buffer: imageBuffer };
const documentFile = { name: '需求说明.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nUI attachment fixture') };
const conversations = [
  { _id: firstId, title: '第一段对话', model: 'historical-chat-model', messages: [{ id: 'first-message', role: 'user', content: '第一段内容' }] },
  { _id: secondId, title: '第二段对话', model: 'historical-chat-model', messages: [{ id: 'second-message', role: 'user', content: '第二段内容' }] },
];

async function readChatUpload(route, fileId) {
  const request = route.request();
  assert.equal(request.method(), 'POST');
  const form = await new Request(request.url(), { method: 'POST', headers: request.headers(), body: request.postDataBuffer() }).formData();
  assert.equal(form.get('kind'), 'chat');
  assert.equal(form.has('model'), false);
  const file = form.get('file');
  assert.ok(file instanceof File);
  return { fileId, url: `/api/files/${fileId}`, name: file.name, mimeType: file.type, size: file.size, extension: file.name.split('.').at(-1), category: file.type.startsWith('image/') ? 'image' : 'document' };
}

function completeTask(route) {
  return route.fulfill({ json: {
    conversation: { ...conversations[0], messages: [{ id: 'attachment-message', role: 'user', content: route.request().postDataJSON().prompt }] },
    task: { _id: 'attachment-task', conversationId: firstId, status: 'completed' },
  } });
}

async function transferFile(page, action, file, size) {
  return page.evaluate(({ action, name, type, bytes, size }) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([size ? new Uint8Array(size) : new Uint8Array(bytes)], name, { type }));
    if (action === 'paste') {
      const event = new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true });
      document.querySelector('.composer-shell textarea').dispatchEvent(event);
      return event.defaultPrevented;
    }
    const shell = document.querySelector('.composer-shell');
    const dragover = new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true });
    shell.dispatchEvent(dragover);
    const drop = new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true });
    shell.dispatchEvent(drop);
    return dragover.defaultPrevented && drop.defaultPrevented;
  }, { action, name: file.name, type: file.mimeType, bytes: Array.from(file.buffer), size });
}

async function withChat(run, ip = '192.0.2.250', beforeLoad) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { 'x-forwarded-for': ip } });
  try {
    assert.equal((await context.request.post(`${base}/api/auth/login`, { data: { email: 'member@example.test', password: 'Vectaix-Test-2026!' } })).status(), 200);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/conversations', route => route.fulfill({ json: { conversations } }));
    await page.route('**/api/conversations/*', route => route.fulfill({ json: { conversation: conversations.find(item => route.request().url().endsWith(item._id)) } }));
    await page.route('**/api/tasks?*', route => route.fulfill({ json: { tasks: [] } }));
    if (beforeLoad) await beforeLoad(page);
    await page.goto(base);
    await page.getByRole('textbox', { name: '消息', exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('[aria-label="退出登录"]') || [...document.querySelectorAll('[role="alert"]')].some(element => element.textContent.startsWith('设置加载失败')));
    await run(page);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
    await browser.close();
  }
}

test('设置加载失败后可重试，保留草稿和搜索偏好', { timeout: 90000 }, async () => {
  let attempts = 0;
  await withChat(async page => {
    const retry = page.getByRole('button', { name: '重新加载设置', exact: true });
    await retry.waitFor();
    const input = page.getByRole('textbox', { name: '消息', exact: true });
    await input.fill('加载完成后继续发送');
    assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isDisabled(), true);
    await retry.click();
    await retry.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => !document.querySelector('button[aria-label="发送"]').disabled);
    assert.equal(await input.inputValue(), '加载完成后继续发送');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('vectaix_ui_webSearch')).enabled), false);
    await page.route('**/api/tasks', route => {
      const body = route.request().postDataJSON();
      assert.equal(body.prompt, '加载完成后继续发送');
      assert.equal(body.webSearch.enabled, false);
      return completeTask(route);
    });
    await input.press('Enter');
    await page.waitForFunction(() => document.querySelector('.composer-shell textarea').value === '');
  }, '192.0.2.240', async page => {
    await page.addInitScript(() => localStorage.setItem('vectaix_ui_webSearch', JSON.stringify({ enabled: false })));
    await page.route('**/api/settings', route => ++attempts === 1
      ? route.fulfill({ status: 503, json: { error: '加载设置失败' } })
      : route.continue());
  });
});

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
    await page.getByRole('button', { name: '重新发送', exact: true }).waitFor();
    await page.getByRole('button', { name: '第二段对话', exact: true }).click({ position: { x: 20, y: 20 } });
    await page.getByText('第二段内容', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '重新发送', exact: true }).count(), 0);
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
      const body = route.request().postDataJSON();
      assert.equal(body.conversationId, firstId);
      assert.equal(Object.hasOwn(body, 'model'), false);
      await route.fulfill({ status: 400, json: { error: '发送已到达恢复的对话' } });
    });
    const input = page.getByPlaceholder('输入问题或描述任务，也可以添加文件…');
    await input.fill('恢复完成后发送');
    await input.press('Enter');
    assert.equal(submitted, 0);
    release();
    await page.getByText('第一段内容', { exact: true }).waitFor();
    await input.press('Enter');
    await page.getByText('发送已到达恢复的对话', { exact: true }).waitFor();
    assert.equal(submitted, 1);
  }, '192.0.2.253', async page => {
    await page.addInitScript(id => {
      window.localStorage.setItem('vectaix-current-conversation', id);
      window.localStorage.setItem('vectaix_ui_model', 'historical-chat-model');
    }, firstId);
    await page.route(`**/api/conversations/${firstId}`, async route => {
      observed();
      await held;
      await route.fulfill({ json: { conversation: conversations[0] } });
    });
  });
});

test('编辑历史消息提交途中切换对话，保留原消息附件', { timeout: 90000 }, async () => {
  await withChat(async page => {
    const fileId = 'edited-image';
    let release;
    const held = new Promise(resolve => { release = resolve; });
    let deleted = 0;
    const conversation = { ...conversations[0], messages: [{ ...conversations[0].messages[0], parts: [{ text: '第一段内容' }, { inlineData: { fileId, url: `/api/files/${fileId}`, mimeType: 'image/png' } }] }] };
    await page.route(`**/api/conversations/${firstId}`, route => route.fulfill({ json: { conversation } }));
    await page.route(`**/api/files/${fileId}`, route => {
      if (route.request().method() === 'DELETE') deleted += 1;
      return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVMcAAAAASUVORK5CYII=', 'base64') });
    });
    await page.route('**/api/tasks', async route => {
      assert.deepEqual(route.request().postDataJSON().attachments, [{ fileId }]);
      await held;
      await route.fulfill({ json: { conversation: conversations[0], task: { _id: 'edit-task', conversationId: firstId, status: 'completed' } } });
    });
    await page.getByRole('button', { name: '第一段对话', exact: true }).click({ position: { x: 20, y: 20 } });
    await page.getByText('第一段内容', { exact: true }).waitFor();
    await page.getByRole('button', { name: '编辑消息', exact: true }).click();
    await page.getByRole('img', { name: '参考图片 1', exact: true }).waitFor();
    assert.equal(await page.locator('.composer-shell input[type="file"]').count(), 1);
    await page.getByRole('button', { name: '重新发送', exact: true }).waitFor();
    const sent = page.waitForRequest(request => request.url().endsWith('/api/tasks') && request.method() === 'POST');
    await page.getByRole('button', { name: '重新发送', exact: true }).click();
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
      const body = route.request().postDataJSON();
      assert.equal(Object.hasOwn(body, 'model'), false);
      const { prompt } = body;
      await held;
      await route.fulfill({ json: {
        conversation: { _id: firstId, messages: [{ id: 'sent-message', role: 'user', content: prompt }] },
        task: { _id: 'test-task', conversationId: firstId, status: 'completed' },
      } });
    });
    const input = page.getByPlaceholder('输入问题或描述任务，也可以添加文件…');
    assert.equal(await page.locator('.composer-shell textarea').count(), 1);
    assert.equal(await page.locator('.composer-shell button').count(), 2);
    assert.equal(await page.locator('.composer-shell input').count(), 1);
    assert.equal(await page.locator('.composer-shell').getByRole('button', { name: '上传图片或附件', exact: true }).count(), 1);
    const fileInput = page.getByLabel('选择图片或附件', { exact: true });
    assert.equal(await fileInput.getAttribute('type'), 'file');
    assert.equal(await fileInput.evaluate(element => element.multiple), true);
    assert.equal(await fileInput.isVisible(), false);
    await input.fill('正在输入中文');
    const accepted = await input.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })));
    assert.equal(accepted, true, '选词回车应继续交给输入法处理');
    assert.equal(submitted, 0);
    assert.equal(await input.inputValue(), '正在输入中文');

    const requested = page.waitForRequest(request => request.url().endsWith('/api/tasks') && request.method() === 'POST');
    await input.press('Enter');
    await requested;
    await page.getByRole('button', { name: '新任务', exact: true }).first().click();
    release();
    await page.waitForFunction(() => document.querySelector('textarea')?.value === '');
    await page.getByRole('heading', { name: '你想完成什么？', exact: true }).waitFor();
    assert.equal(await page.locator('button[aria-current="page"]').count(), 0);
    assert.equal(await page.getByText('正在输入中文', { exact: true }).count(), 0);
    assert.equal(submitted, 1);
  });
});

test('选择图片与文档后预览，移除图片期间等候完成，再只发送文档', { timeout: 90000 }, async () => {
  await withChat(async page => {
    const uploads = [];
    const requests = [];
    let releaseDelete;
    const deleting = new Promise(resolve => { releaseDelete = resolve; });
    await page.route('**/api/upload', async route => {
      const attachment = await readChatUpload(route, `selected-${uploads.length + 1}`);
      uploads.push(attachment);
      await route.fulfill({ status: 201, json: attachment });
    });
    await page.route('**/api/files/*', async route => {
      if (route.request().method() === 'DELETE') {
        assert.equal(route.request().url(), `${base}/api/files/selected-1`);
        await deleting;
        await route.fulfill({ json: { success: true } });
      } else {
        await route.fulfill({ contentType: 'image/png', body: imageBuffer });
      }
    });
    await page.route('**/api/tasks', async route => {
      requests.push(route.request().postDataJSON());
      await completeTask(route);
    });
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '上传图片或附件', exact: true }).click();
    await (await chooser).setFiles([imageFile, documentFile]);
    const attachments = page.getByRole('list', { name: '待发送附件', exact: true });
    await attachments.getByText(documentFile.name, { exact: true }).waitFor();
    await attachments.getByText(imageFile.name, { exact: true }).waitFor();
    await page.waitForFunction(name => {
      const image = Array.from(document.querySelectorAll('.composer-shell img')).find(element => element.alt === name);
      return image?.complete && image.naturalWidth > 0;
    }, imageFile.name);
    assert.equal(await attachments.getByRole('img', { name: imageFile.name, exact: true }).count(), 1);
    assert.equal(await attachments.getByRole('link', { name: `预览 ${documentFile.name}`, exact: true }).getAttribute('href'), '/api/files/selected-2');
    assert.deepEqual(uploads.map(file => file.name), [imageFile.name, documentFile.name]);

    const deleteRequest = page.waitForRequest(request => request.method() === 'DELETE' && request.url().endsWith('/api/files/selected-1'));
    await attachments.getByRole('button', { name: `移除 ${imageFile.name}`, exact: true }).click();
    await deleteRequest;
    assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isDisabled(), true);
    await page.getByRole('textbox', { name: '消息', exact: true }).press('Enter');
    assert.equal(requests.length, 0);
    releaseDelete();
    await attachments.getByRole('button', { name: `移除 ${imageFile.name}`, exact: true }).waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('textbox', { name: '消息', exact: true }).inputValue(), '');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await attachments.waitFor({ state: 'detached' });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].prompt, '请分析附件');
    assert.deepEqual(requests[0].attachments, [{ fileId: 'selected-2' }]);
    assert.equal(Object.hasOwn(requests[0], 'model'), false);
  }, '192.0.2.240');
});

test('部分上传失败保留已上传附件和文字，同文件重试与发送重试沿用草稿', { timeout: 90000 }, async () => {
  await withChat(async page => {
    let uploadCount = 0;
    const requests = [];
    await page.route('**/api/files/*', route => route.fulfill({ contentType: 'image/png', body: imageBuffer }));
    await page.route('**/api/upload', async route => {
      uploadCount += 1;
      const attachment = await readChatUpload(route, `retry-${uploadCount}`);
      await route.fulfill(uploadCount === 2
        ? { status: 503, json: { error: '文档上传暂时失败' } }
        : { status: 201, json: attachment });
    });
    await page.route('**/api/tasks', async route => {
      requests.push(route.request().postDataJSON());
      if (requests.length === 1) await route.fulfill({ status: 503, json: { error: '消息发送暂时失败' } });
      else await completeTask(route);
    });
    const input = page.getByRole('textbox', { name: '消息', exact: true });
    const files = page.getByLabel('选择图片或附件', { exact: true });
    const attachments = page.getByRole('list', { name: '待发送附件', exact: true });
    await input.fill('请结合附件整理要点');
    await files.setInputFiles([imageFile, documentFile]);
    await page.getByRole('alert').filter({ hasText: '文档上传暂时失败' }).waitFor();
    assert.equal(await input.inputValue(), '请结合附件整理要点');
    assert.equal(await attachments.getByRole('listitem').count(), 1);
    assert.equal(await attachments.getByRole('button', { name: `移除 ${imageFile.name}`, exact: true }).count(), 1);
    assert.equal(await files.inputValue(), '');
    await files.setInputFiles(documentFile);
    await attachments.getByText(documentFile.name, { exact: true }).waitFor();
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByText('消息发送暂时失败', { exact: true }).waitFor();
    assert.equal(await input.inputValue(), '请结合附件整理要点');
    assert.equal(await attachments.getByRole('listitem').count(), 2);
    assert.equal(await attachments.getByRole('img', { name: imageFile.name, exact: true }).count(), 1);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await attachments.waitFor({ state: 'detached' });
    assert.equal(await input.inputValue(), '');
    assert.equal(uploadCount, 3);
    assert.equal(requests.length, 2);
    for (const request of requests) {
      assert.equal(request.prompt, '请结合附件整理要点');
      assert.deepEqual(request.attachments, [{ fileId: 'retry-1' }, { fileId: 'retry-3' }]);
    }
  }, '192.0.2.241');
});

test('附件上传完成后启用发送，上传期间回车保留文字', { timeout: 90000 }, async () => {
  await withChat(async page => {
    let releaseUpload;
    const uploading = new Promise(resolve => { releaseUpload = resolve; });
    const requests = [];
    await page.route('**/api/upload', async route => {
      const attachment = await readChatUpload(route, 'pending-document');
      await uploading;
      await route.fulfill({ status: 201, json: attachment });
    });
    await page.route('**/api/tasks', async route => {
      requests.push(route.request().postDataJSON());
      await completeTask(route);
    });
    const input = page.getByRole('textbox', { name: '消息', exact: true });
    await input.fill('等待附件上传');
    const uploadRequest = page.waitForRequest('**/api/upload');
    await page.getByLabel('选择图片或附件', { exact: true }).setInputFiles(documentFile);
    await uploadRequest;
    assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isDisabled(), true);
    await input.press('Enter');
    assert.equal(requests.length, 0);
    assert.equal(await input.inputValue(), '等待附件上传');
    releaseUpload();
    await page.getByRole('list', { name: '待发送附件', exact: true }).getByText(documentFile.name, { exact: true }).waitFor();
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByRole('list', { name: '待发送附件', exact: true }).waitFor({ state: 'detached' });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].prompt, '等待附件上传');
    assert.deepEqual(requests[0].attachments, [{ fileId: 'pending-document' }]);
  }, '192.0.2.242');
});

test('上传途中切换账号时取消原批次，新账号从空白草稿开始', { timeout: 90000 }, async () => {
  await withChat(async page => {
    let releaseUpload, finishUpload;
    const uploading = new Promise(resolve => { releaseUpload = resolve; });
    const uploadFinished = new Promise(resolve => { finishUpload = resolve; });
    const uploads = [];
    const failedUploads = [];
    page.on('requestfailed', request => {
      if (request.url().endsWith('/api/upload')) failedUploads.push(request);
    });
    await page.route('**/api/files/*', route => route.fulfill({ contentType: 'image/png', body: imageBuffer }));
    await page.route('**/api/upload', async route => {
      const attachment = await readChatUpload(route, `account-${uploads.length + 1}`);
      uploads.push(attachment);
      if (uploads.length === 1) {
        await uploading;
        try { await route.fulfill({ status: 201, json: attachment }); }
        finally { finishUpload(); }
      } else {
        await route.fulfill({ status: 201, json: attachment });
      }
    });
    const input = page.getByRole('textbox', { name: '消息', exact: true });
    await input.fill('原账号的附件草稿');
    const firstUpload = page.waitForRequest('**/api/upload');
    await page.getByLabel('选择图片或附件', { exact: true }).setInputFiles([imageFile, documentFile]);
    const firstRequest = await firstUpload;
    assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await page.getByPlaceholder('邮箱', { exact: true }).fill('admin@example.test');
    await page.getByPlaceholder('密码', { exact: true }).fill('Vectaix-Test-2026!');
    const loginResponse = page.waitForResponse(response => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    const response = await loginResponse;
    assert.equal(response.status(), 200);
    assert.equal((await response.json()).user.email, 'admin@example.test');
    await input.waitFor();
    releaseUpload();
    await uploadFinished;
    await page.waitForLoadState('networkidle');
    assert.deepEqual(uploads.map(file => file.name), [imageFile.name]);
    assert.deepEqual(failedUploads, [firstRequest]);
    assert.match(firstRequest.failure().errorText, /ABORTED/);
    assert.equal(await input.inputValue(), '');
    assert.equal(await page.getByRole('list', { name: '待发送附件', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '上传图片或附件', exact: true }).isEnabled(), true);
    assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isDisabled(), true);
  }, '192.0.2.239');
});

test('粘贴图片与拖放文档立即上传，并随文字一起发送', { timeout: 90000 }, async () => {
  await withChat(async page => {
    const uploads = [];
    const requests = [];
    await page.route('**/api/files/*', route => route.fulfill({ contentType: 'image/png', body: imageBuffer }));
    await page.route('**/api/upload', async route => {
      const attachment = await readChatUpload(route, `transfer-${uploads.length + 1}`);
      uploads.push(attachment);
      await route.fulfill({ status: 201, json: attachment });
    });
    await page.route('**/api/tasks', async route => {
      requests.push(route.request().postDataJSON());
      await completeTask(route);
    });
    const input = page.getByRole('textbox', { name: '消息', exact: true });
    const attachments = page.getByRole('list', { name: '待发送附件', exact: true });
    await input.fill('整理图片和文档');
    assert.equal(await transferFile(page, 'paste', imageFile), true);
    await attachments.getByRole('img', { name: imageFile.name, exact: true }).waitFor();
    assert.equal(await transferFile(page, 'drop', documentFile), true);
    await attachments.getByText(documentFile.name, { exact: true }).waitFor();
    assert.deepEqual(uploads.map(file => file.name), [imageFile.name, documentFile.name]);
    assert.equal(await input.inputValue(), '整理图片和文档');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await attachments.waitFor({ state: 'detached' });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].prompt, '整理图片和文档');
    assert.deepEqual(requests[0].attachments, [{ fileId: 'transfer-1' }, { fileId: 'transfer-2' }]);
  }, '192.0.2.243');
});

test('附件数量与大小在上传前校验，五个附件时显示全部卡片', { timeout: 90000 }, async () => {
  await withChat(async page => {
    let uploads = 0;
    await page.route('**/api/upload', async route => {
      const attachment = await readChatUpload(route, `limit-${++uploads}`);
      await route.fulfill({ status: 201, json: attachment });
    });
    const files = page.getByLabel('选择图片或附件', { exact: true });
    const documents = Array.from({ length: 6 }, (_, index) => ({ name: `资料${index + 1}.txt`, mimeType: 'text/plain', buffer: Buffer.from('附件内容') }));
    await files.setInputFiles(documents);
    await page.getByRole('alert').filter({ hasText: /最多.*5/ }).waitFor();
    assert.equal(uploads, 0);
    await transferFile(page, 'drop', documentFile, 20 * 1024 * 1024 + 1);
    await page.getByRole('alert').filter({ hasText: /20\s?MB/ }).waitFor();
    assert.equal(uploads, 0);
    await files.setInputFiles(documents.slice(0, 5));
    const attachments = page.getByRole('list', { name: '待发送附件', exact: true });
    await attachments.getByText('资料5.txt', { exact: true }).waitFor();
    assert.equal(await attachments.getByRole('listitem').count(), 5);
    assert.equal(uploads, 5);
    assert.equal(await page.getByRole('button', { name: '上传图片或附件', exact: true }).isDisabled(), true);
    await transferFile(page, 'paste', imageFile);
    await page.getByRole('alert').filter({ hasText: /最多.*5/ }).waitFor();
    assert.equal(uploads, 5);
    assert.equal(await attachments.getByRole('listitem').count(), 5);
  }, '192.0.2.244');
});

test('登录网络失败给出提示，退出请求失败时保留当前会话', { timeout: 90000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ locale: 'zh-CN' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/auth/login', route => route.abort('failed'));
    await page.goto(base);
    await page.getByPlaceholder('邮箱', { exact: true }).fill('member@example.test');
    await page.getByPlaceholder('密码', { exact: true }).fill('Vectaix-Test-2026!');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByText('网络连接失败，请检查网络后重试。', { exact: true }).waitFor();
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

test('删除确认默认聚焦取消，回车取消且焦点留在对话内', { timeout: 90000 }, async () => {
  await withChat(async page => {
    let deletes = 0;
    await page.route(`**/api/conversations/${firstId}`, route => {
      if (route.request().method() === 'DELETE') { deletes += 1; return route.fulfill({ json: { success: true } }); }
      return route.fulfill({ json: { conversation: conversations[0] } });
    });
    const row = page.getByRole('button', { name: '第一段对话', exact: true });
    await page.getByRole('button', { name: '“第一段对话”的操作', exact: true }).click();
    await page.getByRole('menuitem', { name: '删除', exact: true }).click();
    const dialog = page.getByRole('alertdialog', { name: '删除对话', exact: true });
    await dialog.waitFor();
    await dialog.getByRole('button', { name: '取消', exact: true }).focus();
    await page.keyboard.press('Enter');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(deletes, 0);
    await page.getByRole('button', { name: '“第一段对话”的操作', exact: true }).click();
    await page.getByRole('menuitem', { name: '删除', exact: true }).click();
    await dialog.waitFor();
    await dialog.getByRole('button', { name: '删除', exact: true }).focus();
    await page.keyboard.press('Tab');
    assert.equal(await dialog.getByRole('button', { name: '取消', exact: true }).evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(deletes, 0);
  }, '192.0.2.230');
});

test('切换历史失败时保留原对话内容和草稿，下一条消息发往原对话', { timeout: 90000 }, async () => {
  await withChat(async page => {
    await page.getByRole('button', { name: '第一段对话', exact: true }).click({ position: { x: 20, y: 20 } });
    await page.getByText('第一段内容', { exact: true }).waitFor();
    const input = page.getByRole('textbox', { name: '消息', exact: true });
    await input.fill('第一段草稿');
    await page.route(`**/api/conversations/${secondId}`, route => route.fulfill({ status: 503, json: { error: '第二段读取失败' } }));
    await page.getByRole('button', { name: '第二段对话', exact: true }).click({ position: { x: 20, y: 20 } });
    await page.getByText('加载对话失败：第二段读取失败', { exact: true }).waitFor();
    assert.equal(await page.getByText('第一段内容', { exact: true }).count(), 1);
    assert.equal(await input.inputValue(), '第一段草稿');
    let sent;
    await page.route('**/api/tasks', async route => { sent = route.request().postDataJSON(); await completeTask(route); });
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.composer-shell textarea').value === '');
    assert.equal(sent.conversationId, firstId);
  }, '192.0.2.231');
});

test('切换成功与新任务会清空草稿和待发送附件', { timeout: 90000 }, async () => {
  await withChat(async page => {
    await page.route('**/api/upload', async route => route.fulfill({ status: 201, json: await readChatUpload(route, 'isolated-draft') }));
    await page.getByRole('textbox', { name: '消息', exact: true }).fill('留在原任务的内容');
    await page.getByLabel('选择图片或附件', { exact: true }).setInputFiles(documentFile);
    await page.getByRole('list', { name: '待发送附件', exact: true }).waitFor();
    await page.getByRole('button', { name: '第一段对话', exact: true }).click({ position: { x: 20, y: 20 } });
    await page.getByText('第一段内容', { exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: '消息', exact: true }).inputValue(), '');
    assert.equal(await page.getByRole('list', { name: '待发送附件', exact: true }).count(), 0);
    await page.getByRole('textbox', { name: '消息', exact: true }).fill('重新开始前的草稿');
    await page.getByRole('button', { name: '新任务', exact: true }).click();
    assert.equal(await page.getByRole('textbox', { name: '消息', exact: true }).inputValue(), '');
  }, '192.0.2.232');
});

test('历史重试明确确认会删除后续对话和成果，取消保留所有内容', { timeout: 90000 }, async () => {
  const conversation = { ...conversations[0], messages: [
    { id: 'question-one', role: 'user', content: '第一问' },
    { id: 'answer-one', role: 'model', content: '第一答', taskId: 'task-one', taskStatus: 'completed' },
    { id: 'question-two', role: 'user', content: '第二问' },
    { id: 'answer-two', role: 'model', content: '第二答', taskId: 'task-two', taskStatus: 'completed' },
  ] };
  await withChat(async page => {
    let submits = 0;
    await page.route(`**/api/conversations/${firstId}`, route => route.fulfill({ json: { conversation } }));
    await page.route('**/api/tasks', route => { submits += 1; return completeTask(route); });
    await page.getByRole('button', { name: '第一段对话', exact: true }).click({ position: { x: 20, y: 20 } });
    await page.getByText('第一答', { exact: true }).waitFor();
    const regenerate = page.getByRole('button', { name: '重新生成', exact: true }).first();
    await regenerate.focus();
    await regenerate.click();
    const dialog = page.getByRole('alertdialog', { name: '重新生成回复', exact: true });
    await dialog.waitFor();
    assert.match(await dialog.textContent(), /后续.*对话.*成果/);
    assert.equal(submits, 0);
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await page.getByText('第二答', { exact: true }).count(), 1);
    assert.equal(submits, 0);
  }, '192.0.2.233');
});

test('资料栏加载失败明确提供重新加载入口', { timeout: 90000 }, async () => {
  await withChat(async page => {
    let failing = true, retried = false;
    await page.route(`**/api/conversations/${firstId}/files`, route => {
      if (!failing) retried = true;
      return failing ? route.fulfill({ status: 503, json: { error: '资料读取失败' } }) : route.fulfill({ json: { files: [] } });
    });
    await page.getByRole('button', { name: '第一段对话', exact: true }).click({ position: { x: 20, y: 20 } });
    await page.getByText('第一段内容', { exact: true }).waitFor();
    await page.getByRole('button', { name: '资料与成果', exact: true }).click();
    const panel = page.getByRole('complementary', { name: '对话资料与成果', exact: true });
    await panel.getByRole('alert').waitFor();
    failing = false;
    await panel.getByRole('button', { name: '重新加载资料', exact: true }).click();
    await panel.getByRole('button', { name: '上传文件', exact: true }).waitFor();
    assert.equal(await panel.getByRole('alert').count(), 0);
    assert.equal(retried, true);
  }, '192.0.2.234');
});

test('确认请求读取失败可手动重载，核对内容后只提交一次决定', { timeout: 90000 }, async () => {
  const taskId = '0000000000000000000000a1';
  const conversation = { ...conversations[0], messages: [
    { id: 'approval-question', role: 'user', content: '发出待确认内容' },
    { id: 'approval-reply', role: 'model', content: '', taskId, taskStatus: 'waiting_approval' },
  ] };
  await withChat(async page => {
    let failing = true, decisions = 0;
    const approval = { _id: 'review-one', status: 'pending', tool: '发送测试消息', arguments: { to: 'test@example.test', body: '确认正文' } };
    await page.route(`**/api/conversations/${firstId}`, route => route.fulfill({ json: { conversation } }));
    await page.route('**/api/tasks?*', route => route.fulfill({ json: { tasks: [{ _id: taskId, conversationId: firstId, status: 'waiting_approval', output: '', mediaTasks: [] }] } }));
    await page.route(`**/api/tasks/${taskId}/approvals`, route => failing ? route.fulfill({ status: 503, json: { error: '确认请求读取失败' } }) : route.fulfill({ json: { approvals: [approval] } }));
    await page.route(`**/api/tasks/${taskId}/approvals/review-one`, async route => { decisions += 1; assert.equal(route.request().postDataJSON().decision, 'approved'); await route.fulfill({ json: { approval: { ...approval, status: 'approved' } } }); });
    await page.getByRole('button', { name: '第一段对话', exact: true }).click({ position: { x: 20, y: 20 } });
    await page.getByText('确认请求读取失败', { exact: true }).waitFor();
    failing = false;
    await page.getByRole('button', { name: '重新加载确认请求', exact: true }).click();
    await page.getByText('确认正文', { exact: true }).waitFor();
    await page.getByRole('button', { name: '允许这一次', exact: true }).click();
    await page.getByRole('button', { name: '允许这一次', exact: true }).waitFor({ state: 'hidden' });
    assert.equal(decisions, 1);
  }, '192.0.2.235');
});

test('图片下载失败留在灯箱显示错误，保留关闭和重试入口', { timeout: 90000 }, async () => {
  await withChat(async page => {
    const fileId = 'lightbox-download';
    const conversation = { ...conversations[0], messages: [{ id: 'picture-message', role: 'user', content: '图片', parts: [{ text: '图片' }, { inlineData: { fileId, mimeType: 'image/png', url: `/api/files/${fileId}` } }] }] };
    await page.route(`**/api/conversations/${firstId}`, route => route.fulfill({ json: { conversation } }));
    await page.route(`**/api/files/${fileId}`, route => route.request().resourceType() === 'fetch' ? route.fulfill({ status: 503, json: { error: '图片读取失败' } }) : route.fulfill({ contentType: 'image/png', body: imageBuffer }));
    await page.getByRole('button', { name: '第一段对话', exact: true }).click({ position: { x: 20, y: 20 } });
    const picture = page.locator('.msg-bubble-user img');
    await picture.waitFor();
    await picture.click();
    const dialog = page.getByRole('dialog', { name: '查看大图', exact: true });
    await dialog.waitFor();
    await dialog.getByRole('button', { name: '下载', exact: true }).click();
    await dialog.getByRole('alert').waitFor();
    assert.match(await dialog.getByRole('alert').textContent(), /503/);
    assert.equal(await dialog.getByRole('button', { name: '下载', exact: true }).isEnabled(), true);
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
  }, '192.0.2.236');
});

test('编辑消息显示文档附件，移除后重发只包含保留的内容', { timeout: 90000 }, async () => {
  await withChat(async page => {
    const conversation = { ...conversations[0], messages: [{ id: 'document-message', role: 'user', content: '原始文档问题', parts: [{ text: '原始文档问题' }, { fileData: { fileId: 'editable-document', url: '/api/files/editable-document', name: '原始附件.pdf', mimeType: 'application/pdf', category: 'document', extension: 'pdf', size: 1024 } }] }] };
    await page.route(`**/api/conversations/${firstId}`, route => route.fulfill({ json: { conversation } }));
    let body;
    await page.route('**/api/tasks', async route => { body = route.request().postDataJSON(); await completeTask(route); });
    await page.getByRole('button', { name: '第一段对话', exact: true }).click({ position: { x: 20, y: 20 } });
    await page.getByText('原始文档问题', { exact: true }).waitFor();
    const edit = page.getByRole('button', { name: '编辑消息', exact: true });
    await edit.focus(); await edit.click();
    await page.getByRole('button', { name: '移除 原始附件.pdf', exact: true }).click();
    await page.getByRole('textbox', { name: '编辑消息', exact: true }).fill('去掉附件的新问题');
    await page.getByRole('button', { name: '重新发送', exact: true }).click();
    await page.getByRole('textbox', { name: '编辑消息', exact: true }).waitFor({ state: 'hidden' });
    assert.deepEqual(body.attachments, []);
    assert.equal(body.replaceFromMessageId, 'document-message');
    assert.equal(body.prompt, '去掉附件的新问题');
  }, '192.0.2.237');
});

test('登录后滚动阅读历史时，任务刷新保留阅读位置，回到底部后继续跟随', { timeout: 90000 }, async () => {
  await withChat(async page => {
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await page.getByPlaceholder('邮箱', { exact: true }).fill('member@example.test');
    await page.getByPlaceholder('密码', { exact: true }).fill('Vectaix-Test-2026!');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    const taskId = '0000000000000000000000b1';
    let updates = 0;
    const longReply = Array.from({ length: 60 }, (_, index) => `这是一段用于滚动的任务内容 ${index + 1}。`).join('\n\n');
    const conversation = { ...conversations[0], messages: [{ id: 'scroll-question', role: 'user', content: '很长的任务' }, { id: 'scroll-reply', role: 'model', content: longReply, taskId, taskStatus: 'running' }] };
    await page.route(`**/api/conversations/${firstId}`, route => route.fulfill({ json: { conversation } }));
    await page.route('**/api/tasks?*', route => route.fulfill({ json: { tasks: [{ _id: taskId, conversationId: firstId, status: 'running', output: `${longReply}\n\n刷新 ${++updates}`, mediaTasks: [] }] } }));
    await page.getByRole('button', { name: '第一段对话', exact: true }).click({ position: { x: 20, y: 20 } });
    const list = page.locator('.mobile-scroll');
    await page.waitForFunction(() => { const list = document.querySelector('.mobile-scroll'); return list.scrollHeight > list.clientHeight * 2 && list.scrollTop > 100; });
    await list.hover();
    await page.mouse.wheel(0, -900);
    await page.getByRole('button', { name: '滚动到底部', exact: true }).waitFor();
    await page.waitForFunction(() => {
      const top = document.querySelector('.mobile-scroll').scrollTop;
      const previous = window.__chatScrollTest;
      window.__chatScrollTest = { top, frames: previous?.top === top ? previous.frames + 1 : 0 };
      return window.__chatScrollTest.frames >= 5;
    });
    const top = await list.evaluate(element => element.scrollTop);
    const before = updates;
    await page.waitForFunction(() => document.querySelector('.msg-bubble-ai')?.textContent.includes('刷新'));
    await page.waitForResponse(response => response.url().includes('/api/tasks?'));
    assert.ok(updates > before);
    const after = await list.evaluate(element => element.scrollTop);
    assert.ok(Math.abs(after - top) < 80, `轮询更新应保留手动上滑后的阅读位置：${top} → ${after}`);
    await page.getByRole('button', { name: '滚动到底部', exact: true }).click();
    await page.waitForFunction(() => { const list = document.querySelector('.mobile-scroll'); return list.scrollHeight - list.scrollTop - list.clientHeight < 80; });
  }, '192.0.2.238');
});

test('资料栏保留未包含在最近任务列表中的历史成果和引用', { timeout: 90000 }, async () => {
  await withChat(async page => {
    const conversation = { ...conversations[0], messages: [
      { id: 'old-question', role: 'user', content: '历史调研任务' },
      { id: 'old-reply', role: 'model', content: '历史调研结果', taskId: 'old-task', taskStatus: 'completed', artifacts: [{ fileId: 'old-report', url: '/api/files/old-report', name: '历史报告.pdf', mimeType: 'application/pdf' }], citations: [{ title: '历史引用来源', url: 'https://example.test/research' }] },
    ] };
    await page.route(`**/api/conversations/${firstId}`, route => route.fulfill({ json: { conversation } }));
    await page.route(`**/api/conversations/${firstId}/files`, route => route.fulfill({ json: { files: [] } }));
    await page.getByRole('button', { name: '第一段对话', exact: true }).click({ position: { x: 20, y: 20 } });
    await page.getByText('历史调研结果', { exact: true }).waitFor();
    await page.getByRole('button', { name: '资料与成果', exact: true }).click();
    const panel = page.getByRole('complementary', { name: '对话资料与成果', exact: true });
    await panel.getByRole('tab', { name: '成果与引用', exact: true }).click();
    assert.equal(await panel.getByRole('link', { name: '历史报告.pdf', exact: true }).getAttribute('href'), '/api/files/old-report?download=1');
    assert.equal(await panel.getByRole('link', { name: /历史引用来源/ }).getAttribute('href'), 'https://example.test/research');
  }, '192.0.2.229');
});
