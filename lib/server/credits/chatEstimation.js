const TEXT_BYTES_PER_TOKEN = 3;
const MULTIMODAL_SAFETY_FACTOR = 1.1;
const GEMINI_IMAGE_TOKENS = 258 * 16;
const GEMINI_AUDIO_TOKENS_PER_SECOND = 32;
const GEMINI_VIDEO_TOKENS_PER_SECOND = 263;


function serializeWithoutMediaPayload(inputPayload) {
  const mediaContainers = new WeakSet();
  let imageCount=0;
  const serialized=JSON.stringify(inputPayload, function replaceMediaPayload(key, value) {
    if(value&&typeof value==='object'&&!Array.isArray(value)) {
      if(['image_url','input_image'].includes(value.type)||value.type==='image'&&value.source)imageCount++;
      if(key==='inlineData'&&String(value.mimeType).startsWith('image/'))imageCount++;
    }
    if (
      ["image_url", "input_audio", "video_url", "inlineData", "source"].includes(key)
      && value
      && typeof value === "object"
      && !Array.isArray(value)
    ) {
      mediaContainers.add(value);
      return value;
    }
    if (typeof value !== "string") return value;
    if (/^data:(?:image|audio|video)\/[a-z0-9.+-]+;base64,/i.test(value)) {
      return "[media]";
    }
    if (mediaContainers.has(this) && ["data", "url"].includes(key)) {
      return "[media]";
    }
    return value;
  });
  return {serialized,imageCount};
}

function requireDuration(file, field, label) {
  const duration = Number(file?.[field]);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`${label}缺少可计费时长`);
  }
  return duration;
}

function estimateAttachmentTokens(file, provider) {
  if (file?.category === "image") {
    return ['google','gemini'].includes(provider) ? GEMINI_IMAGE_TOKENS : 4096;
  }
  if (file?.category === "audio") {
    return Math.ceil(
      requireDuration(file, "audioDuration", "音频")
        * GEMINI_AUDIO_TOKENS_PER_SECOND
        * MULTIMODAL_SAFETY_FACTOR,
    );
  }
  if (file?.category === "video") {
    return Math.ceil(
      requireDuration(file, "videoDuration", "视频")
        * GEMINI_VIDEO_TOKENS_PER_SECOND
        * MULTIMODAL_SAFETY_FACTOR,
    );
  }
  return 0;
}

export function estimateChatInputTokens({ inputPayload, provider, files = [] } = {}) {
  const {serialized,imageCount} = serializeWithoutMediaPayload(inputPayload);
  const textTokens = Math.ceil(Buffer.byteLength(serialized || "", "utf8") / TEXT_BYTES_PER_TOKEN);
  const fileMediaTokens = files.reduce(
    (total, file) => total + estimateAttachmentTokens(file, provider),
    0,
  );
  const additionalImages=Math.max(0,imageCount-files.filter(file=>file.category==='image').length);
  const mediaTokens=fileMediaTokens+additionalImages*estimateAttachmentTokens({category:'image'},provider);
  const total = textTokens + mediaTokens;
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error("聊天输入 token 预估超出安全范围");
  }
  return total;
}
