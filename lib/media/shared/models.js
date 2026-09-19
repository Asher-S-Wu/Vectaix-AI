export const IMAGE_MODEL = "gpt-image-2.5-sunburst";
export const QWEN_IMAGE_MODEL = "qwen-image-3.0-pro";
export const AUDIO_MODEL = "qwen-audio-3.0-tts-plus";

export const IMAGE_MODEL_NAME = "GPT Image 2.5";
export const AUDIO_MODEL_NAME = "Qwen Audio 3.0 TTS Plus";

export const MEDIA_MODELS = Object.freeze([
  Object.freeze({
    id: QWEN_IMAGE_MODEL,
    name: "Qwen Image 3.0 Pro",
    provider: "image-gen",
    group: "media",
    mediaType: "image",
    nativeInputs: ["text", "image"],
  }),
  Object.freeze({
    id: IMAGE_MODEL,
    name: IMAGE_MODEL_NAME,
    provider: "image-gen",
    group: "media",
    mediaType: "image",
    nativeInputs: ["text", "image"],
  }),
  Object.freeze({
    id: "gpt-image-2.5-flare",
    name: IMAGE_MODEL_NAME,
    provider: "image-gen",
    group: "media",
    mediaType: "image",
    nativeInputs: ["text", "image"],
  }),
]);

export const IMAGE_PROMPT_MAX_LENGTH = 32000;
export const IMAGE_EDIT_MAX_COUNT = 3;
export const IMAGE_EDIT_MAX_BYTES = 10 * 1024 * 1024;
export const IMAGE_EDIT_ACCEPTED_MIME_TYPES = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/bmp",
  "image/x-ms-bmp",
  "image/tiff",
  "image/webp",
  "image/gif",
]);
export const IMAGE_EDIT_ACCEPTED_EXTENSIONS = Object.freeze([
  "jpg",
  "jpeg",
  "png",
  "bmp",
  "tif",
  "tiff",
  "webp",
  "gif",
]);
export const IMAGE_SIZE_OPTIONS = Object.freeze([
  Object.freeze({ id: "auto", label: "自动" }),
  Object.freeze({ id: "1024x1024", label: "1:1 正方形" }),
  Object.freeze({ id: "1536x1024", label: "3:2 横版" }),
  Object.freeze({ id: "1024x1536", label: "2:3 竖版" }),
]);

const MICU_IMAGE_SIZES = Object.freeze([
  Object.freeze({ id: "auto", label: "自动" }),
  Object.freeze({ id: "1024x1024", label: "1:1 正方形 · 1K" }),
  Object.freeze({ id: "1280x720", label: "16:9 横版 · 1K" }),
  Object.freeze({ id: "720x1280", label: "9:16 竖版 · 1K" }),
  Object.freeze({ id: "1024x1536", label: "2:3 竖版 · 1K" }),
  Object.freeze({ id: "1536x1024", label: "3:2 横版 · 1K" }),
  Object.freeze({ id: "1152x864", label: "4:3 横版 · 1K" }),
  Object.freeze({ id: "864x1152", label: "3:4 竖版 · 1K" }),
  Object.freeze({ id: "1344x576", label: "21:9 超宽 · 1K" }),
  Object.freeze({ id: "2048x2048", label: "1:1 正方形 · 2K" }),
  Object.freeze({ id: "2048x1152", label: "16:9 横版 · 2K" }),
  Object.freeze({ id: "1152x2048", label: "9:16 竖版 · 2K" }),
  Object.freeze({ id: "3840x2160", label: "16:9 横版 · 4K（实验性）" }),
  Object.freeze({ id: "2160x3840", label: "9:16 竖版 · 4K（实验性）" }),
]);
const MICU_IMAGE_OPTIONS = Object.freeze({
  service: "micu",
  sizes: MICU_IMAGE_SIZES,
  defaultSize: "1024x1024",
  fixedQuality: "low",
  maxReferenceImages: 10,
  maxImageBytes: 4 * 1024 * 1024,
  maxTotalImageBytes: 8 * 1024 * 1024,
  mimeTypes: Object.freeze(["image/png", "image/jpeg", "image/webp"]),
  extensions: Object.freeze(["png", "jpg", "jpeg", "webp"]),
  promptMaxLength: IMAGE_PROMPT_MAX_LENGTH,
});

export const IMAGE_MODELS = Object.freeze([
  Object.freeze({
    id: QWEN_IMAGE_MODEL,
    name: "Qwen Image 3.0 Pro",
    service: "qwen",
    sizes: IMAGE_SIZE_OPTIONS,
    defaultSize: "auto",
    maxReferenceImages: IMAGE_EDIT_MAX_COUNT,
    maxImageBytes: IMAGE_EDIT_MAX_BYTES,
    maxTotalImageBytes: IMAGE_EDIT_MAX_COUNT * IMAGE_EDIT_MAX_BYTES,
    mimeTypes: IMAGE_EDIT_ACCEPTED_MIME_TYPES,
    extensions: IMAGE_EDIT_ACCEPTED_EXTENSIONS,
    promptMaxLength: IMAGE_PROMPT_MAX_LENGTH,
  }),
  Object.freeze({
    ...MICU_IMAGE_OPTIONS,
    id: IMAGE_MODEL,
    name: IMAGE_MODEL_NAME,
  }),
  Object.freeze({
    ...MICU_IMAGE_OPTIONS,
    id: "gpt-image-2.5-flare",
    name: IMAGE_MODEL_NAME,
  }),
]);

export const IMAGE_MODEL_OPTIONS = Object.freeze([
  Object.freeze({
    id: IMAGE_MODEL,
    name: IMAGE_MODEL_NAME,
    modes: Object.freeze([
      Object.freeze({ id: IMAGE_MODEL, label: "质量" }),
      Object.freeze({ id: "gpt-image-2.5-flare", label: "速度" }),
    ]),
  }),
  Object.freeze({
    id: QWEN_IMAGE_MODEL,
    name: "Qwen Image 3.0 Pro",
    modes: Object.freeze([]),
  }),
]);

function imageValidationError(message) {
  return Object.assign(new Error(message), { status: 400 });
}

export function getImageModelOption(id) {
  const option = IMAGE_MODEL_OPTIONS.find((item) => item.id === id || item.modes.some((mode) => mode.id === id));
  if (!option) throw imageValidationError("请选择支持的图片模型");
  return option;
}

export function getImageModelConfig(id) {
  const config = IMAGE_MODELS.find((model) => model.id === id);
  if (!config) throw imageValidationError("请选择支持的图片模型");
  return config;
}

export function validateImageOptions({ model, size, quality } = {}) {
  const config = getImageModelConfig(model);
  if (!config.sizes.some((option) => option.id === size)) {
    throw imageValidationError(`${config.name} 不支持所选图片尺寸，请重新选择`);
  }
  if (config.fixedQuality) {
    return { model, size, quality: config.fixedQuality };
  }
  if (quality !== undefined) {
    throw imageValidationError(`${config.name} 不支持画质选项`);
  }
  return { model, size };
}

export function validateImageReferences(model, images, { requireImages = false } = {}) {
  const config = getImageModelConfig(model);
  if (!Array.isArray(images)) throw imageValidationError("参考图片列表无效");
  if (requireImages && images.length === 0) {
    throw imageValidationError("请至少选择一张参考图片");
  }
  if (images.length > config.maxReferenceImages) {
    throw imageValidationError(`${config.name} 最多可选择 ${config.maxReferenceImages} 张参考图片`);
  }

  let totalBytes = 0;
  for (const file of images) {
    if (!file || typeof file.name !== "string" || !file.name.trim() || typeof file.type !== "string" || !Number.isSafeInteger(file.size) || file.size <= 0) {
      throw imageValidationError("参考图片信息无效，请重新选择图片");
    }
    const extension = file.name.match(/\.([^.]+)$/)?.[1].toLowerCase();
    if (!config.extensions.includes(extension) || (file.type !== "" && !config.mimeTypes.includes(file.type))) {
      throw imageValidationError(`${config.name} 不支持“${file.name}”的格式，请选择 ${config.extensions.join("、").toUpperCase()} 图片`);
    }
    if (file.size > config.maxImageBytes) {
      throw imageValidationError(`“${file.name}”超过 ${config.maxImageBytes / (1024 * 1024)}MB，请压缩后再上传`);
    }
    totalBytes += file.size;
  }
  if (totalBytes > config.maxTotalImageBytes) {
    throw imageValidationError(`${config.name} 参考图片合计不能超过 ${config.maxTotalImageBytes / (1024 * 1024)}MB`);
  }
  return images;
}

export const AUDIO_TEXT_MAX_LENGTH = 32000;
export const AUDIO_INSTRUCTION_MAX_LENGTH = 1000;
export const AUDIO_FORMAT_OPTIONS = Object.freeze([
  Object.freeze({ id: "mp3", label: "MP3" }),
  Object.freeze({ id: "wav", label: "WAV" }),
]);
export const AUDIO_SAMPLE_RATE_OPTIONS = Object.freeze([
  Object.freeze({ id: 16000, label: "16 kHz" }),
  Object.freeze({ id: 24000, label: "24 kHz" }),
  Object.freeze({ id: 48000, label: "48 kHz" }),
]);
export const AUDIO_MAX_SAMPLE_RATE = 48_000;
export const AUDIO_DEFAULT_SAMPLE_RATE = AUDIO_MAX_SAMPLE_RATE;
export const AUDIO_FORMATS = Object.freeze(AUDIO_FORMAT_OPTIONS.map((item) => item.id));
export const AUDIO_SAMPLE_RATES = Object.freeze(AUDIO_SAMPLE_RATE_OPTIONS.map((item) => item.id));
export const AUDIO_LANGUAGE_HINTS = Object.freeze([
  Object.freeze({ id: "", label: "自动识别" }),
  Object.freeze({ id: "zh", label: "中文" }),
  Object.freeze({ id: "en", label: "英语" }),
  Object.freeze({ id: "fr", label: "法语" }),
  Object.freeze({ id: "de", label: "德语" }),
  Object.freeze({ id: "ja", label: "日语" }),
  Object.freeze({ id: "ko", label: "韩语" }),
  Object.freeze({ id: "ru", label: "俄语" }),
  Object.freeze({ id: "pt", label: "葡萄牙语" }),
  Object.freeze({ id: "th", label: "泰语" }),
  Object.freeze({ id: "id", label: "印尼语" }),
  Object.freeze({ id: "vi", label: "越南语" }),
  Object.freeze({ id: "it", label: "意大利语" }),
  Object.freeze({ id: "es", label: "西班牙语" }),
  Object.freeze({ id: "ms", label: "马来西亚语" }),
  Object.freeze({ id: "fil", label: "菲律宾语" }),
  Object.freeze({ id: "ar", label: "阿拉伯语" }),
]);
export const CUSTOM_VOICE_MAX_COUNT = 20;

export const PRESET_AUDIO_VOICES = Object.freeze([
  Object.freeze({
    id: "longanlingxin",
    voiceId: "longanlingxin",
    voice: "longanlingxin",
    name: "龙安灵心",
    source: "system",
    tier: "旗舰系统音色",
    gender: "女",
    age: 25,
    languages: Object.freeze(["zh", "en"]),
    languageLabel: "中文（普通话）、英文",
    trait: "知心温暖音",
    scene: "社交陪伴",
  }),
  Object.freeze({
    id: "longanlufeng",
    voiceId: "longanlufeng",
    voice: "longanlufeng",
    name: "龙安鲁风",
    source: "system",
    tier: "旗舰系统音色",
    gender: "男",
    age: 25,
    languages: Object.freeze(["zh", "en"]),
    languageLabel: "中文（普通话）、英文",
    trait: "明亮开朗音",
    scene: "社交陪伴",
  }),
  Object.freeze({
    id: "qwen-audio-3.0-tts-plus-longluliuche",
    voiceId: "qwen-audio-3.0-tts-plus-longluliuche",
    voice: "qwen-audio-3.0-tts-plus-longluliuche",
    name: "龙露柳澈",
    source: "base",
    tier: "精选基础音色",
    gender: "男",
    age: 34,
    languages: Object.freeze(["zh"]),
    languageLabel: "中文",
    trait: "标准播音音",
    scene: "新闻播报",
  }),
  Object.freeze({
    id: "qwen-audio-3.0-tts-plus-longyuyaoluan",
    voiceId: "qwen-audio-3.0-tts-plus-longyuyaoluan",
    voice: "qwen-audio-3.0-tts-plus-longyuyaoluan",
    name: "龙羽瑶鸾",
    source: "base",
    tier: "精选基础音色",
    gender: "女",
    age: 25,
    languages: Object.freeze(["zh"]),
    languageLabel: "中文",
    trait: "沉稳大气音",
    scene: "有声阅读",
  }),
  Object.freeze({
    id: "qwen-audio-3.0-tts-plus-longhexiaoxuan",
    voiceId: "qwen-audio-3.0-tts-plus-longhexiaoxuan",
    voice: "qwen-audio-3.0-tts-plus-longhexiaoxuan",
    name: "龙荷潇璇",
    source: "base",
    tier: "精选基础音色",
    gender: "男",
    age: 38,
    languages: Object.freeze(["zh"]),
    languageLabel: "中文",
    trait: "文雅书卷音",
    scene: "古风有声书",
  }),
  Object.freeze({
    id: "qwen-audio-3.0-tts-plus-longjufuhe",
    voiceId: "qwen-audio-3.0-tts-plus-longjufuhe",
    voice: "qwen-audio-3.0-tts-plus-longjufuhe",
    name: "龙菊芙荷",
    source: "base",
    tier: "精选基础音色",
    gender: "女",
    age: 7,
    languages: Object.freeze(["zh"]),
    languageLabel: "中文",
    trait: "呆萌软糯音",
    scene: "儿童动漫",
  }),
  Object.freeze({
    id: "qwen-audio-3.0-tts-plus-longluxiaohui",
    voiceId: "qwen-audio-3.0-tts-plus-longluxiaohui",
    voice: "qwen-audio-3.0-tts-plus-longluxiaohui",
    name: "龙露潇晖",
    source: "base",
    tier: "精选基础音色",
    gender: "男",
    age: 35,
    languages: Object.freeze(["zh"]),
    languageLabel: "中文",
    trait: "亲切客服音",
    scene: "智能客服",
  }),
  Object.freeze({
    id: "qwen-audio-3.0-tts-plus-longxianlingling",
    voiceId: "qwen-audio-3.0-tts-plus-longxianlingling",
    voice: "qwen-audio-3.0-tts-plus-longxianlingling",
    name: "龙弦凌岭",
    source: "base",
    tier: "精选基础音色",
    gender: "女",
    age: 25,
    languages: Object.freeze(["zh"]),
    languageLabel: "中文",
    trait: "磁性质感音",
    scene: "深夜电台",
  }),
  Object.freeze({
    id: "qwen-audio-3.0-tts-plus-loongolivialin",
    voiceId: "qwen-audio-3.0-tts-plus-loongolivialin",
    voice: "qwen-audio-3.0-tts-plus-loongolivialin",
    name: "Olivia Lin",
    source: "base",
    tier: "精选基础音色",
    gender: "女",
    age: 28,
    languages: Object.freeze(["en"]),
    languageLabel: "英文",
    trait: "温柔知性音",
    scene: "情感陪伴",
  }),
  Object.freeze({
    id: "qwen-audio-3.0-tts-plus-loongadriangao",
    voiceId: "qwen-audio-3.0-tts-plus-loongadriangao",
    voice: "qwen-audio-3.0-tts-plus-loongadriangao",
    name: "Adrian Gao",
    source: "base",
    tier: "精选基础音色",
    gender: "男",
    age: 22,
    languages: Object.freeze(["en"]),
    languageLabel: "英文",
    trait: "沉稳大气音",
    scene: "有声阅读",
  }),
]);

const PRESET_AUDIO_VOICE_MAP = new Map(PRESET_AUDIO_VOICES.map((item) => [item.id, item]));

export function getPresetAudioVoice(voiceId) {
  return PRESET_AUDIO_VOICE_MAP.get(String(voiceId || "").trim()) || null;
}
