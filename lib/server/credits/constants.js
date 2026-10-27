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
    "deepseek-flash": Object.freeze({
      provider: "deepseek",
      currency: "USD",
      inputPerMillion: 0.3,
      cachedInputPerMillion: 0.006,
      outputPerMillion: 1.2,
      offPeakMultiplier: 0.5,
      holidayCalendar: {
        2026: [['01-01','01-03'],['02-15','02-23'],['04-04','04-06'],['05-01','05-05'],['06-19','06-21'],['09-25','09-27'],['10-01','10-07']],
      },
      pricingUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
      holidayCalendarUrl: 'https://www.gov.cn/zhengce/content/202511/content_7047090.htm',
    }),
  }),
  gptImage: Object.freeze({
    "gpt-image-2.5-sunburst": Object.freeze({ ...GPT_IMAGE_2_5_RATE }),
    "gpt-image-2.5-flare": Object.freeze({ ...GPT_IMAGE_2_5_RATE }),
  }),
  elevenlabsTts: Object.freeze({
    usdPerThousandCharacters: 0.08,
    pricingUrl: 'https://elevenlabs.io/pricing/api',
    verifiedAt: '2026-10-27',
  }),
});

export const DEFAULT_BILLING_SETTINGS = Object.freeze({
  key: BILLING_SETTINGS_KEY,
  version: 8,
  usdToCny: 6.72,
  pricingDate: "2026-10-27",
  rates: DEFAULT_RATES,
});
