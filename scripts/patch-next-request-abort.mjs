import { readFile, writeFile } from 'node:fs/promises';

const bodyStreamsUrl = new URL('../node_modules/next/dist/server/body-streams.js', import.meta.url);
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

const source = await readFile(bodyStreamsUrl, 'utf8');
if (source.includes(patched)) {
  console.log('Next.js request abort patch is already applied.');
} else {
  if (!source.includes(original)) {
    throw new Error('Next.js body-streams.js changed; review the request abort patch for this version.');
  }
  await writeFile(bodyStreamsUrl, source.replace(original, patched));
  console.log('Applied Next.js request abort patch.');
}
