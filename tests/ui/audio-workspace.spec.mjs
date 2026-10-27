import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-chromium';

const base = 'http://localhost:3100';
const voiceA = { id: 'profile-a', profileId: 'profile-a', voiceId: 'a'.repeat(32), displayName: '测试音色甲', status: 'trained', languages: ['zh'] };
const voiceB = { id: 'profile-b', profileId: 'profile-b', voiceId: 'b'.repeat(32), displayName: '测试音色乙', status: 'trained', languages: ['zh'] };
const model = 'eleven_multilingual_v2';

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
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', extraHTTPHeaders: { 'x-forwarded-for': ip } });
  try {
    const login = await context.request.post(`${base}/api/auth/login`, { data: { email: 'admin@example.test', password: 'Vectaix-Test-2026!' } });
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
  const option = page.getByRole('button', { name: new RegExp(`^${voice.displayName}`) });
  await option.click();
  assert.equal(await option.getAttribute('aria-pressed'), 'true');
}

test('管理员声音库支持搜索、音色选择保持、全局参数保存、生成播放下载删除', { timeout: 180000 }, async () => {
  await withPage('192.0.2.240', async page => {
    let submitted, release, deleted = false, savedSettings;
    const generation = { id: 'elevenlabs-ui-generation', generationId: 'elevenlabs-ui-generation', model, voiceId: voiceB.voiceId, voiceName: voiceB.displayName, text: '我的声音配音验收', format: 'wav', sampleRate: 24000, speed: 1.1, stability: 0.6, similarityBoost: 0.75, style: 0, useSpeakerBoost: true, audioUrl: '/api/files/elevenlabs-ui-audio', createdAt: '2026-10-23T00:00:00Z' };
    await page.route('**/api/media/audio/elevenlabs/**', async route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname.endsWith('/voices')) return route.fulfill({ json: { success: true, voices: [voiceA, voiceB] } });
      if (pathname.endsWith('/generations') && request.method() === 'POST') {
        submitted = request.postDataJSON();
        await new Promise(resolve => { release = resolve; });
        return route.fulfill({ status: 201, json: { success: true, generation } });
      }
      if (request.method() === 'DELETE') { deleted = true; return route.fulfill({ json: { success: true } }); }
      return route.fulfill({ json: { success: true, generations: [] } });
    });
    await page.route('**/api/admin/media', route => {
      if (route.request().method() === 'PUT') savedSettings = route.request().postDataJSON();
      return route.fulfill({ json: { success: true, config: savedSettings || {} } });
    });
    await page.route('**/api/files/elevenlabs-ui-audio*', route => route.fulfill({ contentType: 'audio/wav', headers: new URL(route.request().url()).searchParams.has('download') ? { 'content-disposition': 'attachment; filename="elevenlabs-ui.wav"' } : {}, body: wav() }));
    await page.goto(`${base}/admin/media/audio`);
    const nav = page.getByRole('navigation', { name: '媒体工作区' });
    assert.equal(await nav.getByRole('link').count(), 2);
    await page.getByRole('heading', { name: '语音合成', exact: true }).waitFor();
    assert.equal(await page.locator('h1').count(), 1);
    assert.match(await page.title(), /花卷/);
    await page.locator('span').filter({ hasText: /^ElevenLabs Multilingual v2$/ }).first().waitFor();
    await page.getByRole('button', { name: /^测试音色甲/ }).waitFor();
    await page.getByLabel('搜索音色', { exact: true }).fill('乙');
    assert.equal(await page.getByRole('button', { name: /^测试音色甲/ }).count(), 0);
    await chooseVoice(page, voiceB);
    await page.getByLabel('搜索音色', { exact: true }).fill('未匹配的名字');
    await page.getByText('没有找到匹配的声音。', { exact: true }).waitFor();
    await page.getByLabel('搜索音色', { exact: true }).fill('');
    await page.getByRole('button', { name: /^测试音色甲/ }).waitFor();
    await page.reload();
    await page.getByText(voiceB.displayName, { exact: true }).first().waitFor();
    assert.equal(await page.getByRole('button', { name: /^测试音色乙/ }).getAttribute('aria-pressed'), 'true');
    await page.getByLabel('配音文本', { exact: true }).fill(generation.text);
    await page.getByLabel('音频格式', { exact: true }).selectOption('wav');
    await page.getByLabel('采样率', { exact: true }).selectOption('24000');
    await page.getByLabel('语速', { exact: true }).fill('1.1');
    await page.getByLabel('稳定度', { exact: true }).fill('0.6');
    await page.getByRole('button', { name: '设为全平台默认参数', exact: true }).click();
    await page.getByText('已保存为全平台媒体默认参数', { exact: true }).waitFor();
    const parameters = { model, voiceId: voiceB.voiceId, format: 'wav', sampleRate: 24000, speed: 1.1, stability: 0.6, similarityBoost: 0.75, style: 0, useSpeakerBoost: true };
    assert.deepEqual(savedSettings.audio, { provider: 'elevenlabs', ...parameters });
    try {
      const dispatched = page.waitForRequest(request => request.url().endsWith('/elevenlabs/generations') && request.method() === 'POST');
      await page.getByRole('button', { name: '生成语音', exact: true }).click();
      await dispatched;
      await page.getByRole('button', { name: '正在生成', exact: true }).waitFor();
      assert.deepEqual(submitted, { ...parameters, text: generation.text });
      assert.equal(await page.getByRole('tab', { name: '声音复刻', exact: true }).isDisabled(), true);
      release();
      const audio = page.getByLabel(`${voiceB.displayName} 生成的语音`, { exact: true });
      await audio.waitFor();
      assert.equal(await audio.getAttribute('controls'), '');
      await audio.evaluate(async element => { await element.play(); element.pause(); });
      const downloaded = page.waitForEvent('download');
      await page.getByRole('link', { name: '下载音频', exact: true }).click();
      assert.equal((await downloaded).suggestedFilename(), 'elevenlabs-ui.wav');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(os.tmpdir(), 'vectaix-elevenlabs-desktop.png'), fullPage: true });
      await page.getByRole('button', { name: '删除记录', exact: true }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: '删除', exact: true }).click();
      await audio.waitFor({ state: 'detached' });
      await page.getByRole('alertdialog').waitFor({ state: 'detached' });
      assert.equal(deleted, true);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => window.scrollTo(0, 0));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(os.tmpdir(), 'vectaix-elevenlabs-mobile.png'), fullPage: true });
    } finally { release?.(); }
  });
});

test('ElevenLabs 声音复刻提交样本授权、刷新状态、试听并删除音色', { timeout: 120000 }, async () => {
  await withPage('192.0.2.241', async page => {
    const custom = { id: 'elevenlabs-profile-test', profileId: 'elevenlabs-profile-test', voiceId: 'c'.repeat(32), displayName: '我的测试声音', status: 'verification_required', languages: ['zh'] };
    let submitted, previewed, removed = false;
    await page.route('**/api/media/audio/elevenlabs/**', async route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname.endsWith('/voices') && request.method() === 'POST') {
        submitted = request.postDataBuffer().toString('latin1');
        return route.fulfill({ status: 201, json: { success: true, voice: custom } });
      }
      if (pathname.endsWith('/voices')) return route.fulfill({ json: { success: true, voices: [] } });
      if (pathname.endsWith('/preview')) { previewed = request.postDataJSON(); return route.fulfill({ contentType: 'audio/wav', body: wav() }); }
      if (pathname.endsWith('/elevenlabs-profile-test') && request.method() === 'GET') return route.fulfill({ json: { success: true, voice: { ...custom, status: 'trained' } } });
      if (request.method() === 'DELETE') { removed = true; return route.fulfill({ json: { success: true } }); }
      return route.fulfill({ json: { success: true, generations: [] } });
    });
    await page.addInitScript(() => localStorage.setItem('vectaix_ui_elevenlabsAudioVoice_v1', 'd'.repeat(32)));
    await page.goto(`${base}/admin/media/audio`);
    await page.getByText('先复刻一个声音，即可在这里选择并生成配音。', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '生成语音', exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => localStorage.getItem('vectaix_ui_elevenlabsAudioVoice_v1')), null);
    await page.getByRole('button', { name: '复刻声音', exact: true }).click();
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
    await page.getByRole('tab', { name: '文字配音', exact: true }).click();
    const library = page.getByRole('region', { name: '声音库', exact: true });
    await library.getByText('请在 ElevenLabs 完成声音验证后刷新', { exact: true }).waitFor();
    assert.equal(await library.getByRole('button', { name: /^我的测试声音/ }).isDisabled(), true);
    assert.equal(await library.getByRole('button', { name: '试听 我的测试声音', exact: true }).isDisabled(), true);
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
    await page.getByText('请从声音库选择', { exact: true }).waitFor();
    await page.getByText('先复刻一个声音，即可在这里选择并生成配音。', { exact: true }).waitFor();
  });
});

test('后台 ElevenLabs 配置安全提交密钥和参数，保存后清空密钥输入', { timeout: 120000 }, async () => {
  await withPage('192.0.2.243', async page => {
    let config = (await (await page.request.get(`${base}/api/admin/media`)).json()).config;
    let submitted;
    await page.route('**/api/admin/media', route => {
      if (route.request().method() === 'PUT') {
        submitted = route.request().postDataJSON();
        const { apiKey: _apiKey, ...audio } = submitted.audio;
        config = { ...submitted, audio: { ...audio, hasApiKey: true } };
      }
      return route.fulfill({ json: { config } });
    });
    await page.goto(`${base}/admin/media`);
    const section = page.locator('section').filter({ has: page.getByRole('heading', { name: '语音服务 · ElevenLabs Multilingual v2', exact: true }) });
    await section.getByLabel('API Key', { exact: true }).fill('ui-test-elevenlabs-key');
    assert.equal(await section.getByLabel('API 地址', { exact: true }).inputValue(), 'https://api.elevenlabs.io');
    await section.getByRole('checkbox', { name: '启用', exact: true }).check();
    await page.getByRole('button', { name: '保存媒体设置', exact: true }).click();
    await page.getByText('媒体设置已保存，所有用户的花卷将使用这些服务。', { exact: true }).waitFor();
    assert.equal(submitted.audio.apiKey, 'ui-test-elevenlabs-key');
    assert.equal(config.audio.enabled, true);
    assert.equal(config.audio.hasApiKey, true);
    assert.equal(config.audio.model, 'eleven_multilingual_v2');
    assert.equal(config.audio.provider, 'elevenlabs');
    assert.ok(!JSON.stringify(config).includes('ui-test-elevenlabs-key'));
    assert.ok(!JSON.stringify(config).includes('encryptedApiKey'));
    await page.reload();
    await section.getByRole('checkbox', { name: '启用', exact: true }).waitFor();
    assert.equal(await section.getByLabel('API Key', { exact: true }).inputValue(), '');
  });
});
