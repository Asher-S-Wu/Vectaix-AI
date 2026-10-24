import { readFile, writeFile } from 'node:fs/promises';

const original = `function replaceRequestBody(base, stream) {
    for(const key in stream){
        let v = stream[key];
        if (typeof v === 'function') {
            v = v.bind(base);
        }
        base[key] = v;
    }
    return base;
}`;
const patched = `function replaceRequestBody(base, stream) {
    const errorListeners = base.listeners('error');
    for(const key in stream){
        if (key === '_destroy') continue;
        let v = stream[key];
        if (typeof v === 'function') {
            v = v.bind(base);
        }
        base[key] = v;
    }
    for (const listener of errorListeners) base.on('error', listener);
    return base;
}`;

const middlewareOriginal = `                if (bubblingResult) {
                    throw err;
                }`;
const middlewarePatched = `${middlewareOriginal}
                if (err?.code === 'ECONNRESET' && req.originalRequest.aborted && req.originalRequest.errored === err) {
                    return true;
                }`;

async function patchNextFile(relativePath, original, patched) {
  const url = new URL(`../node_modules/next/dist/${relativePath}`, import.meta.url);
  const source = await readFile(url, 'utf8');
  if (source.includes(patched)) {
    console.log(`Next.js request abort patch is already applied: ${relativePath}`);
    return;
  }
  if (!source.includes(original)) {
    throw new Error(`Next.js ${relativePath} changed; review the request abort patch for this version.`);
  }
  await writeFile(url, source.replace(original, patched));
  console.log(`Applied Next.js request abort patch: ${relativePath}`);
}

for (const format of ['', 'esm/']) {
  await patchNextFile(`${format}server/body-streams.js`, original, patched);
  await patchNextFile(`${format}server/next-server.js`, middlewareOriginal, middlewarePatched);
}
