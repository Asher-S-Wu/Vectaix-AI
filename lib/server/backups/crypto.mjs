import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, stat, writeFile, appendFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
const scrypt = promisify(crypto.scrypt);
const MAGIC = Buffer.from('VECTAIX1');
export function validatePassword(value) { if (typeof value !== 'string' || value.length < 10 || value.length > 200) throw new Error('备份密码需要 10 到 200 个字符'); return value; }
export async function encryptBackup(source, destination, password) {
  validatePassword(password);
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = await scrypt(password, salt, 32), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  try { await writeFile(destination, Buffer.concat([MAGIC, salt, iv]), { flag: 'wx', mode: 0o600 }); await pipeline(source, cipher, createWriteStream(destination, { flags: 'a' })); await appendFile(destination, cipher.getAuthTag()); } finally { key.fill(0); }
}
export async function decryptBackup(source, destination, password) {
  validatePassword(password); const file = await open(source, 'r');
  let key;
  try {
    const size = (await file.stat()).size;
    if (size < 52 || size > 1024*1024*1024) throw new Error('备份文件大小无效');
    const header = Buffer.alloc(36), tag = Buffer.alloc(16); await file.read(header, 0, 36, 0); await file.read(tag, 0, 16, size - 16);
    if (!header.subarray(0,8).equals(MAGIC)) throw new Error('这不是 Vectaix 加密备份');
    key = await scrypt(password, header.subarray(8,24), 32); const decipher = crypto.createDecipheriv('aes-256-gcm', key, header.subarray(24,36)); decipher.setAuthTag(tag);
    await pipeline(createReadStream(source, { start: 36, end: size - 17 }), decipher, createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
    return (await stat(destination)).size;
  } catch (error) { if (error.code === 'ERR_OSSL_BAD_DECRYPT' || /authenticate/.test(error.message)) throw new Error('密码错误或备份文件已损坏'); throw error; } finally { key?.fill(0); await file.close(); }
}
