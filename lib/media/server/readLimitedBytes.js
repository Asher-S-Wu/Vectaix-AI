export async function readLimitedBytes(response, maximum, { label, createError }) {
  if (Number(response.headers.get('content-length')) > maximum) {
    await response.body?.cancel();
    throw createError(`${label} 返回内容超过大小限制`);
  }
  if (!response.body) throw createError(`${label} 返回了空内容`);
  const chunks = [], reader = response.body.getReader();
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw createError(`${label} 返回内容超过大小限制`);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}
