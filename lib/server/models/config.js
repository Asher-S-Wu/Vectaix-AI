import { DEFAULT_RATES } from '@/lib/server/credits/constants';

export const DEFAULT_MODEL_ID = 'deepseek-flash';

export const MODEL_PROVIDERS = {
  deepseek: {
    id: 'deepseek',
    protocol: 'responses',
    baseUrl: 'https://api.deepseek.com',
    keyEnv: 'DEEPSEEK_API_KEY',
  },
};

export const MODEL_CONFIGS = [{
  id: DEFAULT_MODEL_ID,
  name: '助手',
  group: 'deepseek',
  provider: 'deepseek',
  providerId: 'deepseek',
  upstreamModel: DEFAULT_MODEL_ID,
  protocol: 'responses',
  contextWindow: 1048576,
  maxOutputTokens: 393216,
  defaultOutputTokens: 393216,
  requestOptions: { reasoning: { effort: 'max' }, top_p: 1 },
  sortOrder: 0,
  enabled: true,
  isDefault: true,
  supportsTools: true,
  supportsWebSearch: true,
  nativeInputs: ['text', 'image'],
  billingMode: 'tokens',
  pricing: DEFAULT_RATES.chat[DEFAULT_MODEL_ID],
}];
