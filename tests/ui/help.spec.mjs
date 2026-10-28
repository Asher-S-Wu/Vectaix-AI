import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-chromium';

const base = 'http://localhost:3100';

async function withPage({ role, ip, viewport = { width: 1280, height: 900 } }, run) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    locale: 'zh-CN',
    viewport,
    reducedMotion: 'reduce',
    extraHTTPHeaders: { 'x-forwarded-for': ip, 'accept-language': 'zh-CN' },
  });
  context.setDefaultTimeout(20000);
  context.setDefaultNavigationTimeout(45000);
  try {
    if (role) {
      const response = await context.request.post(`${base}/api/auth/login`, {
        data: { email: `${role}@example.test`, password: 'Vectaix-Test-2026!' },
      });
      assert.equal(response.status(), 200, `${role} sign-in`);
    }
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await run(page, context);
    assert.deepEqual(errors, [], 'Help flows should have no browser runtime errors');
  } finally {
    await context.close();
    await browser.close();
  }
}

async function assertDocsBeforeLanguage(page) {
  const docs = page.getByRole('link', { name: '帮助文档', exact: true });
  const language = page.getByRole('button', { name: '切换为 English', exact: true });
  await docs.waitFor();
  assert.equal(await docs.evaluate(element => element.nextElementSibling?.getAttribute('aria-label')), '切换为 English');
  const [docsBox, languageBox] = await Promise.all([docs.boundingBox(), language.boundingBox()]);
  assert.ok(docsBox.x + docsBox.width <= languageBox.x + 1, 'Docs should be to the left of the language control');
  assert.ok(Math.abs(docsBox.y + docsBox.height / 2 - languageBox.y - languageBox.height / 2) <= 2, 'Docs and language should share a row');
  return docs;
}

async function assertNoHorizontalOverflow(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Horizontal overflow at ${page.url()}`);
}

test('帮助文档要求登录，普通用户的 HTML 和 RSC 响应隔离管理指南', { timeout: 150000 }, async () => {
  await withPage({ ip: '192.0.2.175' }, async page => {
    await page.goto(`${base}/help`, { waitUntil: 'networkidle' });
    assert.equal(new URL(page.url()).pathname, '/');
    await page.getByRole('heading', { name: '登录花卷', exact: true }).waitFor();
  });

  await withPage({ role: 'admin', ip: '192.0.2.177' }, async (page, context) => {
    const response = await context.request.get(`${base}/help`);
    assert.equal(response.status(), 200);
    const html = await response.text();
    assert.ok(html.includes('连接模型服务'));
    assert.ok(html.includes('发起一个任务'));
    await page.goto(`${base}/help?section=admin-models`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: '模型服务', level: 2, exact: true }).waitFor();
    const topics = page.getByRole('navigation', { name: '帮助目录', exact: true });
    await topics.getByRole('link', { name: '全局技能', exact: true }).click();
    await page.getByRole('heading', { name: '从 GitHub 安装技能', exact: true }).waitFor();
    await topics.getByRole('link', { name: '开始使用', exact: true }).click();
    await page.getByRole('heading', { name: '发起一个任务', exact: true }).waitFor();
  });

  await withPage({ role: 'member', ip: '192.0.2.176' }, async (page, context) => {
    const restrictedContent = ['admin-models', '连接模型服务', '从 GitHub 安装技能', '启用并测试云端执行', '开通图片和语音服务', '删除普通用户账号'];
    for (const rsc of [false, true]) {
      const response = await context.request.get(`${base}/help${rsc ? '?_rsc=help-role-check' : ''}`, { headers: rsc ? { RSC: '1' } : {} });
      assert.equal(response.status(), 200);
      if (rsc) assert.match(response.headers()['content-type'], /text\/x-component/);
      const body = await response.text();
      assert.ok(body.includes('发起一个任务'), `${rsc ? 'RSC' : 'HTML'} should include the user guide`);
      for (const content of restrictedContent) assert.equal(body.includes(content), false, `${rsc ? 'RSC' : 'HTML'} must not send admin content: ${content}`);
    }
    const forbidden = await context.request.get(`${base}/help?section=admin-models`);
    assert.equal(forbidden.status(), 404);
    assert.equal((await forbidden.text()).includes('连接模型服务'), false);
    await page.goto(`${base}/help`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: '开始使用', level: 2, exact: true }).waitFor();
    const topics = page.getByRole('navigation', { name: '帮助目录', exact: true });
    assert.equal(await topics.getByRole('link', { name: '模型服务', exact: true }).count(), 0);
    assert.equal(await topics.getByRole('link', { name: '用户管理', exact: true }).count(), 0);
    await page.getByRole('button', { name: '和花卷打个招呼', exact: true }).waitFor();
  });
});

test('文档入口紧邻语言左侧，返回对话保留草稿，媒体帮助保留返回来源', { timeout: 120000 }, async () => {
  await withPage({ role: 'member', ip: '192.0.2.178' }, async page => {
    await page.goto(base, { waitUntil: 'networkidle' });
    const composer = page.getByRole('textbox', { name: '消息', exact: true });
    await composer.fill('先查帮助，再继续完成这段草稿。');
    await (await assertDocsBeforeLanguage(page)).click();
    await page.getByRole('heading', { name: '帮助文档', level: 1, exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/help');
    assert.equal(await page.getByRole('textbox', { name: '消息', exact: true }).count(), 0);
    await page.getByRole('link', { name: '返回对话', exact: true }).click();
    await composer.waitFor();
    assert.equal(await composer.inputValue(), '先查帮助，再继续完成这段草稿。');

    await page.goto(`${base}/media/image`, { waitUntil: 'networkidle' });
    await (await assertDocsBeforeLanguage(page)).click();
    await page.getByRole('heading', { name: '帮助文档', level: 1, exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('returnTo'), '/media/image');
    const back = page.getByRole('link', { name: '返回媒体创作', exact: true });
    assert.equal(await back.getAttribute('href'), '/media/image');
    await back.click();
    await page.getByRole('heading', { name: '图片生成', exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/media/image');
  });
});

test('中英文覆盖目录、正文和搜索，搜索结果定位文章并给出空结果指引', { timeout: 120000 }, async () => {
  await withPage({ role: 'member', ip: '192.0.2.179' }, async page => {
    await page.goto(`${base}/help`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '切换为 English', exact: true }).click();
    await page.getByRole('heading', { name: 'Help docs', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Start a task', exact: true }).waitFor();
    await page.getByText('Describe what you want to accomplish on the chat page.', { exact: false }).waitFor();
    const topics = page.getByRole('navigation', { name: 'Help topics', exact: true });
    await topics.getByRole('link', { name: 'Images and audio', exact: true }).waitFor();
    const search = page.getByRole('searchbox', { name: 'Search help docs', exact: true });
    await search.fill('voice');
    await page.getByRole('heading', { name: 'Search results', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Say hello to Huajuan', exact: true }).waitFor();
    const result = page.getByRole('link').filter({ has: page.getByRole('heading', { name: 'Clone a voice', exact: true }) });
    const destination = new URL(await result.getAttribute('href'), base);
    await result.click();
    await page.getByRole('heading', { name: 'Images and audio', level: 2, exact: true }).waitFor();
    const article = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Clone a voice', exact: true }) });
    await article.waitFor();
    assert.equal(new URL(page.url()).hash, destination.hash);
    await page.waitForFunction(() => document.activeElement?.id === location.hash.slice(1));
    assert.equal(await article.evaluate(element => element === document.activeElement), true);
    const readingArea = page.getByRole('main');
    const [headingBox, readingBox] = await Promise.all([
      article.getByRole('heading', { name: 'Clone a voice', exact: true }).boundingBox(),
      readingArea.boundingBox(),
    ]);
    assert.ok(headingBox.y >= readingBox.y && headingBox.y + headingBox.height <= readingBox.y + readingBox.height, 'Search should bring the selected article heading into the reading area');
    assert.ok(await readingArea.evaluate(element => element.scrollTop > 0), 'Search should scroll to the article');
    assert.equal(await search.inputValue(), '');

    await search.fill('zzzz-no-matching-help-topic');
    await page.getByRole('status').filter({ hasText: 'No articles match. Try a feature name' }).waitFor();
    assert.equal(await page.getByRole('main').getByRole('link').count(), 0);
    await page.getByRole('button', { name: 'Clear search', exact: true }).click();
    await page.getByRole('heading', { name: 'Images and audio', level: 2, exact: true }).waitFor();
    await page.getByRole('button', { name: 'Switch to 中文', exact: true }).click();
    await page.getByRole('heading', { name: '帮助文档', exact: true }).waitFor();
    await page.getByRole('navigation', { name: '帮助目录', exact: true }).getByRole('link', { name: '图片与语音', exact: true }).waitFor();
    await page.getByRole('heading', { name: '复刻一个音色', exact: true }).waitFor();
    const chineseSearch = page.getByRole('searchbox', { name: '搜索帮助文档', exact: true });
    await chineseSearch.fill('复刻');
    await page.getByRole('heading', { name: '搜索结果', exact: true }).waitFor();
    await page.getByRole('link').filter({ has: page.getByRole('heading', { name: '复刻一个音色', exact: true }) }).waitFor();
  });
});

test('手机目录可切换和返回，320 像素下帮助、聊天和媒体页面完整显示', { timeout: 120000 }, async () => {
  await withPage({ role: 'member', ip: '192.0.2.180', viewport: { width: 320, height: 740 } }, async page => {
    await page.goto(`${base}/help`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: '开始使用', level: 2, exact: true }).waitFor();
    await page.getByRole('button', { name: '和花卷打个招呼', exact: true }).waitFor();
    await assertNoHorizontalOverflow(page);
    const contents = page.getByRole('button', { name: /^目录/ });
    assert.equal(await contents.getAttribute('aria-expanded'), 'false');
    await contents.click();
    const directory = page.getByRole('navigation', { name: '帮助目录', exact: true });
    await directory.getByRole('link', { name: '文件与资料', exact: true }).click();
    await page.getByRole('heading', { name: '文件与资料', level: 2, exact: true }).waitFor();
    assert.equal(await contents.getAttribute('aria-expanded'), 'false');
    assert.equal(await directory.isVisible(), false);
    await assertNoHorizontalOverflow(page);
    await page.goBack();
    await page.getByRole('heading', { name: '开始使用', level: 2, exact: true }).waitFor();
    await page.goForward();
    await page.getByRole('heading', { name: '文件与资料', level: 2, exact: true }).waitFor();
    await page.getByRole('button', { name: '切换为 English', exact: true }).click();
    await page.getByRole('heading', { name: 'Files and resources', level: 2, exact: true }).waitFor();
    await assertNoHorizontalOverflow(page);
    await page.getByRole('button', { name: 'Switch to 中文', exact: true }).click();
    await page.getByRole('link', { name: '返回对话', exact: true }).click();
    await page.getByRole('textbox', { name: '消息', exact: true }).waitFor();
    await assertDocsBeforeLanguage(page);
    await assertNoHorizontalOverflow(page);
    await page.goto(`${base}/media/audio`, { waitUntil: 'networkidle' });
    await assertDocsBeforeLanguage(page);
    await assertNoHorizontalOverflow(page);
  });
});
