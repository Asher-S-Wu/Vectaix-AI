const TEXT_BYTES_PER_TOKEN = 3;
const IMAGE_TOKENS = 4096;

export function estimateChatInputTokens({ inputPayload, files = [] } = {}) {
  let imageCount = 0;
  const serialized = JSON.stringify(inputPayload, (key, value) => {
    if (value && typeof value === 'object' && ['input_image', 'image_url', 'image'].includes(value.type)) {
      imageCount++;
      return { type: value.type, image: '[image]' };
    }
    return value;
  });
  const textTokens = Math.ceil(Buffer.byteLength(serialized || '', 'utf8') / TEXT_BYTES_PER_TOKEN);
  const mediaTokens = Math.max(imageCount, files.filter(file => file.category === 'image').length) * IMAGE_TOKENS;
  const total = textTokens + mediaTokens;
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('聊天输入 token 预估超出安全范围');
  return total;
}
