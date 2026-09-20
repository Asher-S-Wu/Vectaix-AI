import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-chromium';

const base = 'http://localhost:3100';

test('工作区滑块先移动，侧栏跨页面滑出与滑入，减少动态效果时直接完成导航', { timeout: 120000 }, async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { 'x-forwarded-for': '192.0.2.220' } });
  try {
    assert.equal((await context.request.post(`${base}/api/auth/login`, { data: { email: 'member@example.test', password: 'Vectaix-Test-2026!' } })).status(), 200);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.motionCaptures = [];
      const start = document.startViewTransition.bind(document);
      document.startViewTransition = (...args) => {
        const transition = start(...args);
        transition.ready.then(() => {
          window.motionCaptures.push({ kind: document.documentElement.dataset.navigationKind, names: document.getAnimations().map(animation => animation.effect?.pseudoElement).filter(Boolean) });
        });
        return transition;
      };
    });
    await page.goto(base);
    const switcher = page.getByRole('navigation', { name: '功能切换', exact: true });
    await switcher.getByRole('link', { name: 'Media', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-mode="media"]'));
    const thumb = await page.locator('.workspace-switch-thumb').evaluate(element => {
      const animation = element.getAnimations()[0];
      if (!animation) return null;
      animation.pause();
      animation.currentTime = 90;
      const x = new DOMMatrix(getComputedStyle(element).transform).m41;
      const width = element.getBoundingClientRect().width;
      animation.play();
      return { x, width };
    });
    assert.ok(thumb && thumb.x > 0 && thumb.x < thumb.width);
    await page.waitForURL(`${base}/media`);
    await page.waitForFunction(() => window.motionCaptures.length === 1);
    assert.ok((await page.evaluate(() => window.motionCaptures[0].names)).includes('::view-transition-old(agent-sidebar)'));
    await page.waitForFunction(() => !document.documentElement.dataset.navigationKind);
    await switcher.getByRole('link', { name: 'Agent', exact: true }).click();
    await page.waitForURL(`${base}/`);
    await page.waitForFunction(() => window.motionCaptures.length === 2);
    assert.ok((await page.evaluate(() => window.motionCaptures[1].names)).includes('::view-transition-new(agent-sidebar)'));
    await page.waitForFunction(() => !document.documentElement.dataset.navigationKind);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await switcher.getByRole('link', { name: 'Media', exact: true }).click();
    await page.waitForURL(`${base}/media`);
    assert.equal(await page.evaluate(() => window.motionCaptures.length), 2);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
    await browser.close();
  }
});

test('媒体子模块、资料栏和手机设置切换保留过渡与可操作布局', { timeout: 120000 }, async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { 'x-forwarded-for': '192.0.2.221' } });
  try {
    assert.equal((await context.request.post(`${base}/api/auth/login`, { data: { email: 'member@example.test', password: 'Vectaix-Test-2026!' } })).status(), 200);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const settled = () => page.waitForFunction(() => !document.documentElement.dataset.navigationKind);
    await page.goto(`${base}/media/image`);
    await page.getByRole('navigation', { name: '媒体工作台' }).getByRole('link', { name: 'Qwen 语音' }).click();
    await page.waitForURL(`${base}/media/audio`);
    await settled();
    await page.evaluate(() => document.documentElement.classList.add('dark-mode'));
    const colors = await page.locator('.workspace-switch-thumb').evaluate(element => ({ thumb: getComputedStyle(element).backgroundColor, track: getComputedStyle(element.parentElement).backgroundColor }));
    assert.notEqual(colors.thumb, colors.track);
    await page.getByRole('tab', { name: '声音复刻' }).click();
    await page.getByRole('tabpanel', { name: '声音复刻' }).waitFor();
    await page.getByRole('navigation', { name: '功能切换', exact: true }).getByRole('link', { name: 'Agent', exact: true }).click();
    await page.waitForURL(`${base}/`);
    await settled();
    await page.getByRole('button', { name: '查看资料与成果', exact: true }).click();
    await page.getByRole('complementary', { name: '对话资料与成果' }).waitFor();
    await settled();
    await page.getByRole('tab', { name: '成果与引用', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('complementary', { name: '对话资料与成果' }).waitFor({ state: 'hidden' });
    await settled();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/settings?section=general`);
    await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: /助手/ }).click();
    await page.getByRole('heading', { name: '助手', exact: true }).waitFor();
    await settled();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByRole('button', { name: '全部设置', exact: true }).click();
    await page.getByRole('navigation', { name: '设置分类' }).waitFor();
    await settled();
    await page.getByRole('link', { name: '返回对话' }).click();
    await page.waitForURL(`${base}/`);
    await settled();
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
    await browser.close();
  }
});
