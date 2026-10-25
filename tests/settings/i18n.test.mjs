import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLocale, translate } from '../../lib/shared/i18n.mjs';
import { localizeMessage, systemMessages } from '../../lib/shared/systemMessages.mjs';

test('首次按浏览器语言及权重选择语言，手选语言优先', () => {
  assert.equal(resolveLocale(undefined, 'en-GB,en;q=0.9,zh-CN;q=0.5'), 'en');
  assert.equal(resolveLocale(undefined, 'zh-TW,zh;q=0.9,en;q=0.8'), 'zh');
  assert.equal(resolveLocale('zh', 'en-US'), 'zh');
  assert.equal(resolveLocale('en', 'zh-CN'), 'en');
  assert.equal(resolveLocale(undefined, 'en;q=0,zh;q=0.5'), 'zh');
});

test('双语模板精确插值，缺少语言或参数会报错', () => {
  assert.equal(translate('en', '共 {count} 项', 'Items: {count}', { count: 3 }), 'Items: 3');
  assert.throws(() => translate('en', '保存'), TypeError);
  assert.throws(() => translate('en', '{count}', '{count}'), /Missing translation/);
});

test('系统消息目录中英文占位符一致，错误可随界面语言重新显示', () => {
  for (const [zh, en] of systemMessages) {
    assert.ok(zh && en);
    assert.deepEqual([...zh.matchAll(/\{(\d+)\}/g)].map(x => x[1]).sort(), [...en.matchAll(/\{(\d+)\}/g)].map(x => x[1]).sort(), zh);
  }
  const english = localizeMessage('密码长度至少为 12 个字符', 'en');
  assert.equal(english, 'Use at least 12 characters for your password.');
  assert.equal(localizeMessage(english, 'zh'), '密码长度至少为 12 个字符');
  assert.equal(localizeMessage('客户写下的项目名称与第三方诊断', 'en'), '客户写下的项目名称与第三方诊断');
  assert.equal(localizeMessage('文字最多 500 个字', 'en'), 'Text can contain up to 500 characters.');
  assert.match(localizeMessage('项目名称不能为空，且最多 200 个字', 'en'), /^Project name is required/);
  assert.equal(localizeMessage('“文件名.png”：头像文件，请在个人资料或助手设置中更换或移除头像', 'en'), '“文件名.png”: Avatar file. Replace or remove the avatar in your profile or assistant settings.');
});
