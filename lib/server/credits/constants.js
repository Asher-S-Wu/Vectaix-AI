import { MINIMAX_VOICE_UNLOCK_PRICE_CNY } from "@/lib/media/shared/minimaxAudio";

export const BILLING_SETTINGS_KEY = "default";

const GPT_IMAGE_2_5_RATE = Object.freeze({
  provider: "openai",
  currency: "USD",
  textInputPerMillion: 5,
  cachedTextInputPerMillion: 1.25,
  imageInputPerMillion: 8,
  cachedImageInputPerMillion: 2,
  imageOutputPerMillion: 30,
  pricingSource: "openai",
  pricingUrl: "https://developers.openai.com/api/docs/pricing",
  verifiedAt: "2026-09-17",
});

export const DEFAULT_RATES = Object.freeze({
  chat: Object.freeze({
    "gpt-6-astra": Object.freeze({
      provider: "openai",
      currency: "USD",
      inputPerMillion: 10,
      cachedInputPerMillion: 1,
      cacheWritePerMillion: 12.5,
      outputPerMillion: 50,
      longContextThreshold: 272000,
      longInputMultiplier: 2,
      longOutputMultiplier: 1.5,
    }),
    "claude-opus-5": Object.freeze({
      provider: "anthropic",
      currency: "USD",
      inputPerMillion: 5,
      cachedInputPerMillion: 0.5,
      cacheWritePerMillion: 6.25,
      cacheWriteTtlMinutes: 5,
      outputPerMillion: 25,
    }),
    "google/gemini-3.8-flash": Object.freeze({
      provider: "google",
      currency: "USD",
      inputPerMillion: 0.75,
      cachedInputPerMillion: 0.075,
      outputPerMillion: 3.75,
    }),
    "grok-4.6": Object.freeze({
      provider: "xai",
      currency: "USD",
      inputPerMillion: 2,
      cachedInputPerMillion: 0.5,
      outputPerMillion: 6,
      longContextThreshold: 200000,
      longContextMultiplier: 2,
      longContextInclusive: true,
    }),
    "kimi-k3": Object.freeze({
      provider: "moonshot",
      currency: "USD",
      inputPerMillion: 3,
      cachedInputPerMillion: 0.3,
      outputPerMillion: 15,
    }),
    "qwen-3.8-max-0902": Object.freeze({
      provider: "qwen",
      currency: "USD",
      inputPerMillion: 2.23095,
      cachedInputPerMillion: 0.2788690476,
      outputPerMillion: 6.691666,
    }),
  }),
  qwenImage: Object.freeze({
    outputCny: Object.freeze({
      "1K": 0.299768,
      "2K": 0.562065,
    }),
    inputImageCny: 0.022483,
  }),
  gptImage: Object.freeze({
    "gpt-image-2.5-sunburst": Object.freeze({ ...GPT_IMAGE_2_5_RATE }),
    "gpt-image-2.5-flare": Object.freeze({ ...GPT_IMAGE_2_5_RATE }),
  }),
  qwenTts: Object.freeze({
    cnyPer10000Characters: 1.49884,
    voiceCloneUsd: 0.01,
  }),
  minimaxTts: Object.freeze({
    cnyPer10000Characters: Object.freeze({
      hd: 3.5,
      turbo: 2,
    }),
    firstVoiceCloneCny: MINIMAX_VOICE_UNLOCK_PRICE_CNY,
  }),
  seedAudio: Object.freeze({
    cnyPerMinute: 1,
  }),
  mediaKit: Object.freeze({
    cnyPerMinute: 10,
  }),
});

export const DEFAULT_BILLING_SETTINGS = Object.freeze({
  key: BILLING_SETTINGS_KEY,
  version: 3,
  usdToCny: 6.72,
  pricingDate: "2026-09-18",
  rates: DEFAULT_RATES,
});
