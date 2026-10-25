export const MODEL_PROTOCOLS = [
  { id: 'chat', label: 'Chat · OpenAI Chat Completions' },
  { id: 'messages', label: 'Message · Anthropic Messages' },
  { id: 'responses', label: 'Response · OpenAI Responses' },
];

export const DEFAULT_MODEL_SETTINGS = {
  baseUrl: '', protocol: 'responses', modelId: '', displayName: '',
  contextWindow: 128000, maxOutputTokens: 8192,
  nativeInputs: ['text', 'image'], supportsTools: true,
  pricing: { inputPerMillion: 0, cachedInputPerMillion: 0, outputPerMillion: 0 },
};
