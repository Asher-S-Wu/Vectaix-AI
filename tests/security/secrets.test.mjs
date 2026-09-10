import test from 'node:test';
import assert from 'node:assert/strict';

test('凭据可解密，但换账号或改密文不能读取', async () => {
  const { encryptSecret, decryptSecret } = await import('../../lib/server/security/secrets.mjs');
  process.env.APP_SECRETS_KEY = Buffer.alloc(32, 7).toString('base64');
  const encrypted = encryptSecret({ token: 'private-key' }, 'connection:user-a:1');
  assert.equal(JSON.stringify(encrypted).includes('private-key'), false);
  assert.deepEqual(decryptSecret(encrypted, 'connection:user-a:1'), { token: 'private-key' });
  assert.throws(() => decryptSecret(encrypted, 'connection:user-b:1'));
  assert.throws(() => decryptSecret({ ...encrypted, tag: Buffer.alloc(16).toString('base64') }, 'connection:user-a:1'));
});

test('未配置加密密钥时拒绝保存凭据', async () => {
  const { encryptSecret } = await import('../../lib/server/security/secrets.mjs');
  delete process.env.APP_SECRETS_KEY;
  assert.throws(() => encryptSecret('secret', 'user'), /APP_SECRETS_KEY/);
});
