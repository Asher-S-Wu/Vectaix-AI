import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-chromium';

const base = 'http://localhost:3100';

test('语音合成统一入口、切换隔离、刷新定位、键盘操作及提交锁定', { timeout: 180000 }, async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', extraHTTPHeaders: { 'x-forwarded-for': '192.0.2.240' } });
  let releaseGeneration;
  let generationStarted;
  try {
    assert.equal((await context.request.post(`${base}/api/auth/login`, { data: { email: 'member@example.test', password: 'Vectaix-Test-2026!' } })).status(), 200);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/media/audio/**', async route => {
      const url = new URL(route.request().url());
      if (route.request().method() === 'POST' && url.pathname.endsWith('/generations')) {
        await new Promise(resolve => { releaseGeneration = resolve; generationStarted(); });
        await route.fulfill({ status: 400, json: { message: '测试生成失败' } });
      } else if (url.pathname.endsWith('/voices')) {
        await route.fulfill({ json: {
          voices: url.pathname.includes('/doubao/') ? [{ profileId: 'doubao-test', voiceId: 'doubao-test', displayName: '测试豆包音色', sampleRate: 24000, duration: 12 }] : [],
          systemVoices: [{ voiceId: 'minimax-test', name: '测试 MiniMax 音色', description: [] }], customVoices: [],
        } });
      } else await route.fulfill({ json: { generations: [] } });
    });
    await page.goto(`${base}/media`);
    assert.equal(await page.getByRole('link', { name: '语音合成', exact: true }).count(), 1);
    await page.getByRole('link', { name: '语音合成', exact: true }).click();
    await page.waitForURL(`${base}/media/audio`);
    const providers = page.getByRole('tablist', { name: '语音服务商' });
    const selected = name => providers.getByRole('tab', { name, exact: true });
    await page.getByRole('heading', { name: '语音合成', exact: true }).waitFor();
    assert.equal(await page.locator('h1').count(), 1);
    assert.equal(await selected('Qwen').getAttribute('aria-selected'), 'true');
    const nav = page.getByRole('navigation', { name: '媒体工作台' });
    assert.equal(await nav.getByRole('link').count(), 3);
    await page.locator('#audio-text').fill('Qwen 独立草稿');
    await selected('MiniMax').click();
    await page.waitForURL('**/media/audio?provider=minimax');
    assert.equal(await page.locator('#minimax-text').inputValue(), '');
    await page.reload();
    assert.equal(await selected('MiniMax').getAttribute('aria-selected'), 'true');
    await page.getByRole('tab', { name: '声音复刻', exact: true }).click();
    await page.getByRole('tabpanel', { name: '声音复刻', exact: true }).waitFor();
    await selected('MiniMax').focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForURL('**/media/audio?provider=doubao');
    await page.getByRole('tab', { name: '声音库', exact: true }).click();
    await page.getByRole('tabpanel', { name: '声音库', exact: true }).waitFor();
    await selected('Qwen').click();
    assert.equal(await page.locator('#audio-text').inputValue(), '');

    await page.goto(`${base}/media/audio?provider=minimax&model=MiniMax%2Fspeech-2.8-turbo`);
    await page.getByText('Speech 2.8 Turbo · MP3 · 44.1kHz', { exact: true }).waitFor();
    for (const [provider, label, field] of [['minimax','MiniMax','#minimax-text'], ['doubao','豆包','#doubao-text'], ['qwen','Qwen','#audio-text']]) {
      await selected(label).click();
      await page.locator(field).fill(`${provider} 测试文本`);
      const started = new Promise(resolve => { generationStarted = resolve; });
      await page.getByRole('button', { name: '生成语音', exact: true }).click();
      await started;
      await page.waitForFunction(() => [...document.querySelectorAll('[aria-label="语音服务商"] button')].every(button => button.disabled));
      assert.equal(new URL(page.url()).searchParams.get('provider'), provider);
      releaseGeneration();
      await page.getByText('测试生成失败', { exact: true }).waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll('[aria-label="语音服务商"] button')].every(button => !button.disabled));
    }
    await page.setViewportSize({ width: 390, height: 844 });
    for (const label of ['Qwen', 'MiniMax', '豆包']) {
      await selected(label).click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    assert.deepEqual(errors, []);
  } finally {
    releaseGeneration?.();
    await context.close();
    await browser.close();
  }
});

test('三个服务商的音色改名提交期间禁止切换，失败后恢复操作', { timeout: 120000 }, async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ reducedMotion: 'reduce', extraHTTPHeaders: { 'x-forwarded-for': '192.0.2.241' } });
  let release;
  let started;
  try {
    assert.equal((await context.request.post(`${base}/api/auth/login`, { data: { email: 'member@example.test', password: 'Vectaix-Test-2026!' } })).status(), 200);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const voice = { id: 'test-voice', profileId: 'test-voice', voiceId: 'test-voice', displayName: '测试声音', status: 'OK', sampleRate: 24000, duration: 12, createdAt: '2026-09-20T00:00:00Z' };
    await page.route('**/api/media/audio/**', async route => {
      if (route.request().method() === 'PATCH') {
        await new Promise(resolve => { release = resolve; started(); });
        await route.fulfill({ status: 400, json: { message: '测试改名失败' } });
      } else await route.fulfill({ json: { voices: [voice], systemVoices: [], customVoices: [voice], generations: [] } });
    });
    for (const [provider, tabName] of [['qwen','声音复刻'], ['minimax','声音复刻'], ['doubao','声音库']]) {
      await page.goto(`${base}/media/audio?provider=${provider}`);
      await page.getByRole('tab', { name: tabName, exact: true }).click();
      await page.getByRole('button', { name: provider === 'doubao' ? '重命名 测试声音' : '修改 测试声音 的名称', exact: true }).click();
      await page.getByLabel('音色名称', { exact: true }).last().fill('修改后的声音');
      const pending = new Promise(resolve => { started = resolve; });
      await page.getByRole('button', { name: '保存名称', exact: true }).click();
      await pending;
      await page.waitForFunction(() => [...document.querySelectorAll('[aria-label="语音服务商"] button')].every(button => button.disabled));
      release();
      await page.getByText('测试改名失败', { exact: true }).waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll('[aria-label="语音服务商"] button')].every(button => !button.disabled));
    }
    assert.deepEqual(errors, []);
  } finally {
    release?.();
    await context.close();
    await browser.close();
  }
});
