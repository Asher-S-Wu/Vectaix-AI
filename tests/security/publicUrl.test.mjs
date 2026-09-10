import test from 'node:test';
import assert from 'node:assert/strict';

test('外部连接拒绝本地、内网和携带登录信息的网址', async () => {
  const { assertPublicUrl } = await import('../../lib/server/security/publicUrl.mjs');
  for (const value of ['https://127.0.0.1', 'http://2130706433', 'https://[::1]', 'https://[::ffff:127.0.0.1]', 'https://10.0.0.1', 'https://169.254.169.254/latest', 'https://user:pass@example.com', 'file:///etc/passwd']) {
    await assert.rejects(assertPublicUrl(value));
  }
  assert.equal((await assertPublicUrl('https://1.1.1.1/dns-query')).hostname, '1.1.1.1');
});
