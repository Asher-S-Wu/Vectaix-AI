export const MINIMAX_AUDIO_MODELS = Object.freeze([
  Object.freeze({ id: "MiniMax/speech-2.8-hd", label: "Speech 2.8 HD", price: "3.5 元 / 万字符" }),
  Object.freeze({ id: "MiniMax/speech-2.8-turbo", label: "Speech 2.8 Turbo", price: "2 元 / 万字符" }),
]);

export const MINIMAX_AUDIO_MODEL_IDS = Object.freeze(
  MINIMAX_AUDIO_MODELS.map((item) => item.id),
);
export const MINIMAX_AUDIO_DEFAULT_MODEL = MINIMAX_AUDIO_MODELS[0].id;
export const MINIMAX_AUDIO_MANAGEMENT_MODEL = "MiniMax/speech-2.8-turbo";

export const MINIMAX_AUDIO_TEXT_MAX_LENGTH = 9999;
export const MINIMAX_VOICE_DEMO_TEXT_MAX_LENGTH = 1000;
export const MINIMAX_VOICE_DISPLAY_NAME_MAX_LENGTH = 60;
export const MINIMAX_CUSTOM_VOICE_MAX_COUNT = 20;

export const MINIMAX_AUDIO_FORMAT_OPTIONS = Object.freeze([
  Object.freeze({ id: "mp3", label: "MP3", mimeType: "audio/mpeg" }),
  Object.freeze({ id: "wav", label: "WAV", mimeType: "audio/wav" }),
  Object.freeze({ id: "flac", label: "FLAC", mimeType: "audio/flac" }),
]);
export const MINIMAX_AUDIO_FORMAT_IDS = Object.freeze(
  MINIMAX_AUDIO_FORMAT_OPTIONS.map((item) => item.id),
);

export const MINIMAX_AUDIO_SAMPLE_RATE_OPTIONS = Object.freeze([
  Object.freeze({ id: 8000, label: "8 kHz" }),
  Object.freeze({ id: 16000, label: "16 kHz" }),
  Object.freeze({ id: 22050, label: "22.05 kHz" }),
  Object.freeze({ id: 24000, label: "24 kHz" }),
  Object.freeze({ id: 32000, label: "32 kHz" }),
  Object.freeze({ id: 44100, label: "44.1 kHz" }),
]);
export const MINIMAX_AUDIO_SAMPLE_RATE_IDS = Object.freeze(
  MINIMAX_AUDIO_SAMPLE_RATE_OPTIONS.map((item) => item.id),
);

export const MINIMAX_AUDIO_EMOTION_OPTIONS = Object.freeze([
  Object.freeze({ id: "", label: "自动判断" }),
  Object.freeze({ id: "happy", label: "高兴" }),
  Object.freeze({ id: "sad", label: "悲伤" }),
  Object.freeze({ id: "angry", label: "愤怒" }),
  Object.freeze({ id: "fearful", label: "害怕" }),
  Object.freeze({ id: "disgusted", label: "厌恶" }),
  Object.freeze({ id: "surprised", label: "惊讶" }),
  Object.freeze({ id: "calm", label: "中性" }),
]);
export const MINIMAX_AUDIO_EMOTION_IDS = Object.freeze(
  MINIMAX_AUDIO_EMOTION_OPTIONS.map((item) => item.id),
);

export const MINIMAX_AUDIO_LANGUAGE_OPTIONS = Object.freeze([
  Object.freeze({ id: "", label: "自动判断" }),
  Object.freeze({ id: "auto", label: "自动增强" }),
  Object.freeze({ id: "Chinese", label: "中文" }),
  Object.freeze({ id: "Chinese,Yue", label: "粤语" }),
  Object.freeze({ id: "English", label: "英语" }),
  Object.freeze({ id: "Japanese", label: "日语" }),
  Object.freeze({ id: "Korean", label: "韩语" }),
  Object.freeze({ id: "French", label: "法语" }),
  Object.freeze({ id: "German", label: "德语" }),
  Object.freeze({ id: "Spanish", label: "西班牙语" }),
  Object.freeze({ id: "Portuguese", label: "葡萄牙语" }),
  Object.freeze({ id: "Italian", label: "意大利语" }),
  Object.freeze({ id: "Russian", label: "俄语" }),
  Object.freeze({ id: "Arabic", label: "阿拉伯语" }),
  Object.freeze({ id: "Turkish", label: "土耳其语" }),
  Object.freeze({ id: "Dutch", label: "荷兰语" }),
  Object.freeze({ id: "Ukrainian", label: "乌克兰语" }),
  Object.freeze({ id: "Vietnamese", label: "越南语" }),
  Object.freeze({ id: "Indonesian", label: "印尼语" }),
  Object.freeze({ id: "Thai", label: "泰语" }),
  Object.freeze({ id: "Polish", label: "波兰语" }),
  Object.freeze({ id: "Romanian", label: "罗马尼亚语" }),
  Object.freeze({ id: "Greek", label: "希腊语" }),
  Object.freeze({ id: "Czech", label: "捷克语" }),
  Object.freeze({ id: "Finnish", label: "芬兰语" }),
  Object.freeze({ id: "Hindi", label: "印地语" }),
  Object.freeze({ id: "Bulgarian", label: "保加利亚语" }),
  Object.freeze({ id: "Danish", label: "丹麦语" }),
  Object.freeze({ id: "Hebrew", label: "希伯来语" }),
  Object.freeze({ id: "Malay", label: "马来语" }),
  Object.freeze({ id: "Persian", label: "波斯语" }),
  Object.freeze({ id: "Slovak", label: "斯洛伐克语" }),
  Object.freeze({ id: "Swedish", label: "瑞典语" }),
  Object.freeze({ id: "Croatian", label: "克罗地亚语" }),
  Object.freeze({ id: "Filipino", label: "菲律宾语" }),
  Object.freeze({ id: "Hungarian", label: "匈牙利语" }),
  Object.freeze({ id: "Norwegian", label: "挪威语" }),
  Object.freeze({ id: "Slovenian", label: "斯洛文尼亚语" }),
  Object.freeze({ id: "Catalan", label: "加泰罗尼亚语" }),
  Object.freeze({ id: "Nynorsk", label: "新挪威语" }),
  Object.freeze({ id: "Tamil", label: "泰米尔语" }),
  Object.freeze({ id: "Afrikaans", label: "南非荷兰语" }),
]);
export const MINIMAX_AUDIO_LANGUAGE_IDS = Object.freeze(
  MINIMAX_AUDIO_LANGUAGE_OPTIONS.map((item) => item.id),
);

export const MINIMAX_EXPRESSIVE_TAGS = Object.freeze([
  Object.freeze({ label: "笑声", value: "(laughs)" }),
  Object.freeze({ label: "轻笑", value: "(chuckle)" }),
  Object.freeze({ label: "咳嗽", value: "(coughs)" }),
  Object.freeze({ label: "清嗓", value: "(clear-throat)" }),
  Object.freeze({ label: "换气", value: "(breath)" }),
  Object.freeze({ label: "吸气", value: "(inhale)" }),
  Object.freeze({ label: "呼气", value: "(exhale)" }),
  Object.freeze({ label: "叹息", value: "(sighs)" }),
  Object.freeze({ label: "抽泣", value: "(crying)" }),
  Object.freeze({ label: "哼唱", value: "(humming)" }),
  Object.freeze({ label: "口哨", value: "(whistles)" }),
  Object.freeze({ label: "嗯", value: "(emm)" }),
]);

export function getMinimaxAudioModel(modelId) {
  return MINIMAX_AUDIO_MODELS.find((item) => item.id === modelId) || null;
}

export function getMinimaxAudioFormat(formatId) {
  return MINIMAX_AUDIO_FORMAT_OPTIONS.find((item) => item.id === formatId) || null;
}

