const TEXT_BYTES_PER_TOKEN = 3;
const MULTIMODAL_SAFETY_FACTOR = 1.1;
const GEMINI_IMAGE_TOKENS = 258 * 16;
const GEMINI_AUDIO_TOKENS_PER_SECOND = 32;
const GEMINI_VIDEO_TOKENS_PER_SECOND = 263;

const IMAGE_TOKEN_BUDGETS = Object.freeze({
  openai: 4096,
  anthropic: 4096,
  google: GEMINI_IMAGE_TOKENS,
  xai: 4096,
  moonshot: 4096,
  qwen: 4096,
});

function serializeWithoutMediaPayload(inputPayload) {
  const mediaContainers = new WeakSet();
  return JSON.stringify(inputPayload, function replaceMediaPayload(key, value) {
    if (
      ["image_url", "input_audio", "video_url"].includes(key)
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
    const budget = IMAGE_TOKEN_BUDGETS[provider];
    if (!Number.isSafeInteger(budget) || budget <= 0) {
      throw new Error("当前模型缺少图片 token 预估规则");
    }
    return budget;
  }
  if (file?.category === "audio") {
    if (provider !== "google") throw new Error("当前模型缺少音频 token 预估规则");
    return Math.ceil(
      requireDuration(file, "audioDuration", "音频")
        * GEMINI_AUDIO_TOKENS_PER_SECOND
        * MULTIMODAL_SAFETY_FACTOR,
    );
  }
  if (file?.category === "video") {
    if (provider !== "google") throw new Error("当前模型缺少视频 token 预估规则");
    return Math.ceil(
      requireDuration(file, "videoDuration", "视频")
        * GEMINI_VIDEO_TOKENS_PER_SECOND
        * MULTIMODAL_SAFETY_FACTOR,
    );
  }
  return 0;
}

export function estimateChatInputTokens({ inputPayload, provider, files = [] } = {}) {
  const serialized = serializeWithoutMediaPayload(inputPayload);
  const textTokens = Math.ceil(Buffer.byteLength(serialized || "", "utf8") / TEXT_BYTES_PER_TOKEN);
  const mediaTokens = files.reduce(
    (total, file) => total + estimateAttachmentTokens(file, provider),
    0,
  );
  const total = textTokens + mediaTokens;
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error("聊天输入 token 预估超出安全范围");
  }
  return total;
}
