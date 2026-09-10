import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function encryptionKey() {
  const value = process.env.APP_SECRETS_KEY?.trim();
  const key = value ? Buffer.from(value, 'base64') : null;
  if (!key || key.length !== 32 || key.toString('base64') !== value) {
    throw new Error('请配置 APP_SECRETS_KEY（32 字节随机密钥的 Base64 编码）');
  }
  return key;
}

export function encryptSecret(value, context) {
  if (typeof context !== 'string' || !context) throw new Error('缺少凭据所属范围');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

export function decryptSecret(envelope, context) {
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8'));
}
