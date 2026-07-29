export const IMAGE_MODEL = "gpt-image-2";
export const VIDEO_MODEL = "doubao-seedance-2-0-mini-260615";
export const AUDIO_MODEL = "qwen-audio-3.0-tts-plus";

export const IMAGE_MODEL_NAME = "GPT Image 2";
export const VIDEO_MODEL_NAME = "Seedance 2.0 Mini";
export const AUDIO_MODEL_NAME = "Qwen Audio 3.0 TTS Plus";

export const MEDIA_MODELS = Object.freeze([
  Object.freeze({
    id: IMAGE_MODEL,
    name: IMAGE_MODEL_NAME,
    provider: "image-gen",
    group: "media",
    mediaType: "image",
    nativeInputs: ["text", "image"],
  }),
  Object.freeze({
    id: VIDEO_MODEL,
    name: VIDEO_MODEL_NAME,
    provider: "video-gen",
    group: "media",
    mediaType: "video",
    nativeInputs: ["text", "image"],
  }),
]);

export const IMAGE_PROMPT_MAX_LENGTH = 32000;
export const IMAGE_EDIT_MAX_BYTES = 25 * 1024 * 1024;
export const IMAGE_EDIT_ACCEPTED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const VIDEO_PROMPT_MAX_LENGTH = 32000;
export const VIDEO_FRAME_MAX_BYTES = 25 * 1024 * 1024;
export const VIDEO_FRAME_ACCEPTED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];
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
export const VOICE_SAMPLE_MAX_BYTES = 10 * 1024 * 1024;
export const VOICE_SAMPLE_ACCEPTED_MIME_TYPES = Object.freeze([
  "audio/wav",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
]);

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

export const IMAGE_SIZE_OPTIONS = [
  { id: "auto", label: "自动" },
  { id: "1024x1024", label: "正方形 1024×1024" },
  { id: "1536x1024", label: "横版 1536×1024" },
  { id: "1024x1536", label: "竖版 1024×1536" },
];

export const VIDEO_ASPECT_RATIO_OPTIONS = [
  { id: "adaptive", label: "智能适配" },
  { id: "16:9", label: "横屏 16:9" },
  { id: "4:3", label: "横屏 4:3" },
  { id: "9:16", label: "竖屏 9:16" },
  { id: "1:1", label: "方形 1:1" },
  { id: "3:4", label: "竖屏 3:4" },
  { id: "21:9", label: "宽屏 21:9" },
];

export const VIDEO_DURATION_OPTIONS = [
  { id: -1, label: "智能" },
  { id: 4, label: "4 秒" },
  { id: 5, label: "5 秒" },
  { id: 8, label: "8 秒" },
  { id: 10, label: "10 秒" },
  { id: 15, label: "15 秒" },
];

export const VIDEO_RESOLUTION_OPTIONS = [
  { id: "480p", label: "480p" },
  { id: "720p", label: "720p" },
];
