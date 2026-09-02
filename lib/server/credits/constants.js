export const BILLING_SETTINGS_KEY = "default";
export const POINTS_PER_CNY = 100;

export const DEFAULT_RATES = Object.freeze({
  chat: Object.freeze({
    "gpt-5.6-sol": Object.freeze({
      provider: "openai",
      currency: "USD",
      inputPerMillion: 8,
      cachedInputPerMillion: 0.8,
      cacheWritePerMillion: 10,
      outputPerMillion: 40,
      longContextThreshold: 272000,
      longInputMultiplier: 2,
      longOutputMultiplier: 1.5,
    }),
    "claude-opus-5": Object.freeze({
      provider: "anthropic",
      currency: "USD",
      inputPerMillion: 5,
      outputPerMillion: 25,
    }),
    "google/gemini-3.7-flash": Object.freeze({
      provider: "google",
      currency: "USD",
      inputPerMillion: 0.75,
      outputPerMillion: 3.75,
    }),
    "grok-4.6": Object.freeze({
      provider: "xai",
      currency: "USD",
      inputPerMillion: 2,
      outputPerMillion: 6,
      longContextThreshold: 200000,
      longContextMultiplier: 2,
    }),
    "kimi-k3": Object.freeze({
      provider: "moonshot",
      currency: "USD",
      inputPerMillion: 3,
      outputPerMillion: 15,
      preferOpenRouterActualCost: true,
    }),
    "qwen-3.8-max": Object.freeze({
      provider: "qwen",
      currency: "USD",
      inputPerMillion: 2.23095,
      cachedInputPerMillion: 0.2788690476,
      outputPerMillion: 6.691666,
    }),
  }),
  exa: Object.freeze({
    search20Usd: 0.017,
    contentsUsd: 0.001,
  }),
  qwenImage: Object.freeze({
    outputCny: Object.freeze({
      "1K": 0.299768,
      "2K": 0.562065,
    }),
    inputImageCny: 0.022483,
  }),
  happyHorse: Object.freeze({
    generationCnyPerSecond: Object.freeze({
      "480": 0.524594,
      "720": 1.049188,
      "1080": 1.348956,
    }),
    editCnyPerSecond: Object.freeze({
      "720": 1.049188,
      "1080": 1.798608,
    }),
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
    firstVoiceCloneCny: 9.9,
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
  version: 1,
  initialCredits: 300,
  costMultiplier: 1.25,
  usdToCny: 6.72,
  chatReservationLimit: 1000,
  pricingDate: "2026-09-01",
  rates: DEFAULT_RATES,
});
