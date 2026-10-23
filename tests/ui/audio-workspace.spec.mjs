import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-chromium';

const base = 'http://localhost:3100';
const voiceA = { id: 'a'.repeat(32), voiceId: 'a'.repeat(32), name: '测试音色甲', description: '清晰中文', languages: ['zh'] };
const voiceB = { id: 'b'.repeat(32), voiceId: 'b'.repeat(32), name: '测试音色乙', description: '自然叙述', languages: ['zh'] };
const model = 's2.1-pro-free';

function wav(seconds = 1) {
  const dataBytes = 24000 * 2 * seconds;
  const bytes = Buffer.alloc(44 + dataBytes);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(24000, 24); bytes.writeUInt32LE(48000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(dataBytes, 40);
  return bytes;
}

async function withPage(ip, run) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', extraHTTPHeaders: { 'x-forwarded-for': ip } });
  try {
    const login = await context.request.post(`${base}/api/auth/login`, { data: { email: 'member@example.test', password: 'Vectaix-Test-2026!' } });
    assert.equal(login.status(), 200);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await run(page);
    assert.equal(await page.getByText('Build Error', { exact: true }).count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function chooseVoice(page, voice) {
  const option = page.getByRole('button', { name: new RegExp(`^${voice.name}`) });
  await option.click();
  assert.equal(await option.getAttribute('aria-pressed'), 'true');
}

test('Fish 免费模型支持音色记忆、参数保存、生成播放下载删除，媒体入口仅图片与语音', { timeout: 180000 }, async () => {
  await withPage('192.0.2.240', async page => {
    let submitted, release, deleted = false, savedSettings;
    const generation = { id: 'fish-ui-generation', generationId: 'fish-ui-generation', model, voiceId: voiceB.voiceId, voiceName: voiceB.name, text: '免费模型配音验收', format: 'wav', sampleRate: 24000, speed: 1.4, volume: 3, audioUrl: '/api/files/fish-ui-audio', createdAt: '2026-10-23T00:00:00Z' };
    await page.route('**/api/media/audio/fish/**', async route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname.endsWith('/voices')) return route.fulfill({ json: { success: true, systemVoices: [voiceA, voiceB], customVoices: [], hasMore: false } });
      if (pathname.endsWith('/generations') && request.method() === 'POST') {
        submitted = request.postDataJSON();
        await new Promise(resolve => { release = resolve; });
        return route.fulfill({ status: 201, json: { success: true, generation } });
      }
      if (request.method() === 'DELETE') { deleted = true; return route.fulfill({ json: { success: true } }); }
      return route.fulfill({ json: { success: true, generations: [] } });
    });
    await page.route('**/api/settings', route => {
      if (route.request().method() === 'PUT') savedSettings = route.request().postDataJSON();
      return route.fulfill({ json: { success: true, settings: savedSettings || { chatMediaSettings: {} } } });
    });
    await page.route('**/api/files/fish-ui-audio*', route => route.fulfill({ contentType: 'audio/wav', headers: new URL(route.request().url()).searchParams.has('download') ? { 'content-disposition': 'attachment; filename="fish-ui.wav"' } : {}, body: wav() }));
    await page.goto(`${base}/media`);
    await page.getByRole('heading', { name: '让想法变成作品' }).waitFor();
    const nav = page.getByRole('navigation', { name: '媒体工作台' });
    assert.equal(await page.locator('section[aria-labelledby="media-title"] a').count(), 2);
    await page.locator('section[aria-labelledby="media-title"] a[href="/media/audio"]').click();
    await page.waitForURL(`${base}/media/audio`);
    assert.equal(await nav.getByRole('link').count(), 2);
    await page.getByRole('heading', { name: '语音合成', exact: true }).waitFor();
    assert.equal(await page.locator('h1').count(), 1);
    assert.match(await page.title(), /Vectaix/i);
    await page.getByText('Fish Audio S2.1 Pro Free', { exact: true }).waitFor();
    await chooseVoice(page, voiceB);
    await page.reload();
    await page.getByText(voiceB.name, { exact: true }).first().waitFor();
    assert.equal(await page.getByRole('button', { name: /^测试音色乙/ }).getAttribute('aria-pressed'), 'true');
    await page.getByLabel('配音文本', { exact: true }).fill(generation.text);
    await page.getByLabel('音频格式', { exact: true }).selectOption('wav');
    await page.getByLabel('采样率', { exact: true }).selectOption('24000');
    await page.getByLabel('语速', { exact: true }).fill('1.4');
    await page.getByLabel('音量', { exact: true }).fill('3');
    await page.getByRole('button', { name: '用于对话配音和朗读', exact: true }).click();
    await page.getByText('对话配音和朗读已使用当前配置', { exact: true }).waitFor();
    const parameters = { model, voiceId: voiceB.voiceId, format: 'wav', sampleRate: 24000, speed: 1.4, volume: 3, temperature: 0.7, topP: 0.7 };
    assert.deepEqual(savedSettings.chatMediaSettings.audio, { provider: 'fish', ...parameters });
    try {
      const dispatched = page.waitForRequest(request => request.url().endsWith('/fish/generations') && request.method() === 'POST');
      await page.getByRole('button', { name: '生成语音', exact: true }).click();
      await dispatched;
      await page.getByRole('button', { name: '正在生成', exact: true }).waitFor();
      assert.deepEqual(submitted, { ...parameters, text: generation.text });
      assert.equal(await page.getByRole('tab', { name: '声音复刻', exact: true }).isDisabled(), true);
      release();
      const audio = page.getByLabel(`${voiceB.name} 生成的语音`, { exact: true });
      await audio.waitFor();
      assert.equal(await audio.getAttribute('controls'), '');
      await audio.evaluate(async element => { await element.play(); element.pause(); });
      const downloaded = page.waitForEvent('download');
      await page.getByRole('link', { name: '下载音频', exact: true }).click();
      assert.equal((await downloaded).suggestedFilename(), 'fish-ui.wav');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(os.tmpdir(), 'vectaix-fish-desktop.png'), fullPage: true });
      await page.getByRole('button', { name: '删除记录', exact: true }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: '删除', exact: true }).click();
      await audio.waitFor({ state: 'detached' });
      assert.equal(deleted, true);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => window.scrollTo(0, 0));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(os.tmpdir(), 'vectaix-fish-mobile.png'), fullPage: true });
    } finally { release?.(); }
  });
});

test('Fish 声音复刻提交样本授权、刷新状态、试听并删除音色', { timeout: 120000 }, async () => {
  await withPage('192.0.2.241', async page => {
    const custom = { id: 'fish-profile-test', profileId: 'fish-profile-test', voiceId: 'c'.repeat(32), displayName: '我的测试声音', status: 'training', languages: ['zh'] };
    let submitted, previewed, removed = false;
    await page.route('**/api/media/audio/fish/**', async route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname.endsWith('/voices') && request.method() === 'POST') {
        submitted = request.postDataBuffer().toString('latin1');
        return route.fulfill({ status: 201, json: { success: true, voice: custom } });
      }
      if (pathname.endsWith('/voices')) return route.fulfill({ json: { success: true, systemVoices: [voiceA], customVoices: [], hasMore: false } });
      if (pathname.endsWith('/preview')) { previewed = request.postDataJSON(); return route.fulfill({ contentType: 'audio/wav', body: wav() }); }
      if (pathname.endsWith('/fish-profile-test') && request.method() === 'GET') return route.fulfill({ json: { success: true, voice: { ...custom, status: 'trained' } } });
      if (request.method() === 'DELETE') { removed = true; return route.fulfill({ json: { success: true } }); }
      return route.fulfill({ json: { success: true, generations: [] } });
    });
    await page.goto(`${base}/media/audio`);
    await page.getByRole('button', { name: /^测试音色甲/ }).waitFor();
    await page.getByRole('tab', { name: '声音复刻', exact: true }).click();
    await page.getByRole('tabpanel', { name: '声音复刻', exact: true }).waitFor();
    await page.getByLabel('音色名称', { exact: true }).fill(custom.displayName);
    assert.equal(await page.getByLabel('音色名称', { exact: true }).getAttribute('maxlength'), '60');
    await page.getByLabel('声音样本', { exact: true }).setInputFiles({ name: 'voice.wav', mimeType: 'audio/wav', buffer: wav(10) });
    assert.equal(await page.getByRole('button', { name: '创建音色', exact: true }).isDisabled(), true);
    await page.getByRole('checkbox', { name: '我拥有这段录音的使用权，并已获得声音本人的授权。', exact: true }).check();
    await page.getByRole('button', { name: '创建音色', exact: true }).click();
    await page.getByRole('button', { name: /^我的测试声音/ }).waitFor();
    assert.match(submitted, /name="displayName"/);
    assert.match(submitted, /name="sample"; filename="voice.wav"/);
    assert.match(submitted, /name="consentConfirmed"\r\n\r\ntrue/);
    assert.equal(await page.getByRole('button', { name: /^我的测试声音/ }).isDisabled(), true);
    await page.getByRole('button', { name: '刷新状态', exact: true }).click();
    await page.getByText('可用', { exact: true }).waitFor();
    await page.getByRole('button', { name: /^我的测试声音/ }).click();
    await page.getByRole('button', { name: '试听 我的测试声音', exact: true }).click();
    await page.getByLabel('音色试听', { exact: true }).waitFor();
    assert.deepEqual(previewed, { voiceId: custom.voiceId });
    await page.getByRole('button', { name: '删除音色', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: '删除', exact: true }).click();
    await page.getByRole('button', { name: /^我的测试声音/ }).waitFor({ state: 'detached' });
    assert.equal(removed, true);
    await page.getByRole('tab', { name: '文字配音', exact: true }).click();
    await page.getByText('请从声音库选择', { exact: true }).waitFor();
  });
});
