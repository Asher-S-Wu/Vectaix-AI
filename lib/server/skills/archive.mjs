import yauzl from 'yauzl';
import yazl from 'yazl';

export function assetPath(value) {
  if (typeof value !== 'string' || !value || value.length > 500 || value.includes('\\') || value.startsWith('/') || value.split('/').some(p => !p || p === '.' || p === '..') || /[\x00-\x1f:]/.test(value)) throw new Error('压缩包包含非法文件路径');
  return value;
}
export async function readZip(buffer, { maxBytes = 100 * 1024 * 1024, maxEntries = 1000 } = {}) {
  const zip = await new Promise((resolve, reject) => yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (err, value) => err ? reject(err) : resolve(value)));
  const files = new Map(); let total = 0, entryCount = 0;
  return new Promise((resolve, reject) => {
    const fail = e => { zip.close(); reject(e); };
    zip.on('error', fail); zip.on('end', () => resolve(files));
    zip.on('entry', entry => {
      try {
        if (++entryCount > maxEntries) throw new Error('压缩包文件数量过多');
        if (entry.fileName.endsWith('/')) { assetPath(entry.fileName.slice(0, -1)); zip.readEntry(); return; }
        const name = assetPath(entry.fileName);
        if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) throw new Error('不支持符号链接');
        total += entry.uncompressedSize;
        if (total > maxBytes || files.size >= maxEntries || files.has(name)) throw new Error('压缩包过大、文件过多或路径重复');
        zip.openReadStream(entry, (error, stream) => {
          if (error) return fail(error);
          const chunks = []; let size = 0;
          stream.on('data', chunk => { size += chunk.length; if (size > entry.uncompressedSize || size > maxBytes) stream.destroy(new Error('文件超过大小限制')); else chunks.push(chunk); });
          stream.on('error', fail); stream.on('end', () => { files.set(name, Buffer.concat(chunks)); zip.readEntry(); });
        });
      } catch (error) { fail(error); }
    }); zip.readEntry();
  });
}
export function zipStream(entries) {
  const zip = new yazl.ZipFile();
  for (const entry of entries) {
    assetPath(entry.name);
    if (entry.path) zip.addFile(entry.path, entry.name); else if (entry.open) zip.addReadStreamLazy(entry.name, callback => { Promise.resolve().then(entry.open).then(stream => callback(null, stream), callback); }); else zip.addBuffer(entry.buffer, entry.name);
  }
  zip.end(); return zip.outputStream;
}

export async function extractZipFile(archivePath, directory, { maxBytes = 512*1024*1024, maxEntries = 100000 } = {}) {
  const { mkdir } = await import('node:fs/promises');
  const { createWriteStream } = await import('node:fs');
  const path = await import('node:path');
  const { Transform } = await import('node:stream');
  const { pipeline } = await import('node:stream/promises');
  const zip = await new Promise((resolve, reject) => yauzl.open(archivePath, { lazyEntries: true, validateEntrySizes: true }, (error, value) => error ? reject(error) : resolve(value)));
  const entries = new Map(); let total = 0, entryCount = 0;
  return new Promise((resolve, reject) => {
    const fail = error => { zip.close(); reject(error); };
    zip.on('error', fail); zip.on('end', () => resolve(entries));
    zip.on('entry', entry => { void (async () => {
      if (++entryCount > maxEntries) throw new Error('备份中的文件数量过多');
      if (entry.fileName.endsWith('/')) { assetPath(entry.fileName.slice(0,-1)); zip.readEntry(); return; }
      const name = assetPath(entry.fileName);
      if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000 || entries.has(name)) throw new Error('备份包含符号链接或重复路径');
      total += entry.uncompressedSize; if (total > maxBytes) throw new Error('备份解压后超过大小限制');
      const target = path.join(directory, name); await mkdir(path.dirname(target), { recursive: true });
      const source = await new Promise((resolveStream, rejectStream) => zip.openReadStream(entry, (error, stream) => error ? rejectStream(error) : resolveStream(stream)));
      let size = 0; const limiter = new Transform({ transform(chunk, encoding, callback) { size += chunk.length; if (size > entry.uncompressedSize) callback(new Error('备份文件内容大小不符')); else callback(null, chunk); } });
      await pipeline(source, limiter, createWriteStream(target, { flags: 'wx', mode: 0o600 }));
      entries.set(name, { path: target, size }); zip.readEntry();
    })().catch(fail); }); zip.readEntry();
  });
}
