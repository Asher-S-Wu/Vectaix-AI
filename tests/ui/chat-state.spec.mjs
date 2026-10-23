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
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { 'x-forwarded-for': ip } });
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
      const body = route.request().postDataJSON();
      assert.equal(body.conversationId, firstId);
      assert.equal(Object.hasOwn(body, 'model'), false);
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
    await page.getByRole('img', { name: '第 1 张参考图片', exact: true }).waitFor();
    assert.equal(await page.locator('.composer-shell input[type="file"]').count(), 1);
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
      const body = route.request().postDataJSON();
      assert.equal(Object.hasOwn(body, 'model'), false);
      const { prompt } = body;
      await held;
      await route.fulfill({ json: {
        conversation: { _id: firstId, messages: [{ id: 'sent-message', role: 'user', content: prompt }] },
        task: { _id: 'test-task', conversationId: firstId, status: 'completed' },
      } });
    });
    const input = page.getByPlaceholder('给 AI 发送消息…');
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
    await page.getByRole('button', { name: '新建对话', exact: true }).first().click();
    release();
    await page.waitForFunction(() => document.querySelector('textarea')?.value === '');
    await page.getByRole('heading', { name: '今天能帮你做点什么？', exact: true }).waitFor();
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
