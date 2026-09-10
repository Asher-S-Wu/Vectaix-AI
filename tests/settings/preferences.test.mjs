import test from 'node:test';
import assert from 'node:assert/strict';

test('设置只接受受支持的权限与助手字段', async () => {
  const { validatePreferences } = await import('../../lib/shared/preferences.mjs');
  assert.deepEqual(validatePreferences({ permissions: { browser: true, microphone: false } }), { permissions: { browser: true, microphone: false } });
  assert.throws(() => validatePreferences({ permissions: { browser: 'yes' } }));
  assert.throws(() => validatePreferences({ permissions: { shell: true } }));
  assert.throws(() => validatePreferences({ assistant: { language: 'wrong' } }));
  assert.throws(() => validatePreferences({ appearance: { completionSoundVolume: 101 } }));
});

test('个性说明不会覆盖当前用户要求，SOUL导出导入保留内容', async () => {
  const { formatSoul, parseSoul, assistantPrompt } = await import('../../lib/shared/preferences.mjs');
  const value = { name: '小助手', language: 'zh', style: '简洁', instructions: '先列来源\n再给结论', avatarFileId: null };
  assert.deepEqual(parseSoul(formatSoul(value)), value);
  assert.match(assistantPrompt(value), /当前用户/);
  assert.match(assistantPrompt(value), /先列来源/);
});
