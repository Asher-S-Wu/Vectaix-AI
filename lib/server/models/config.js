import { DEFAULT_RATES } from '@/lib/server/credits/constants';

export const DEFAULT_MODEL_ID = 'google/gemini-3.8-flash';
export const TRANSCRIPTION_MODEL_ID = 'google/gemini-3.8-flash';
export const MODEL_PROVIDERS = {
  openrouter: { id:'openrouter', protocol:'chat-completions', baseUrl:'https://openrouter.ai/api/v1', keyEnv:'OPENROUTER_API_KEY' },
  'openrouter-responses': { id:'openrouter-responses', protocol:'responses', baseUrl:'https://openrouter.ai/api/v1', keyEnv:'OPENROUTER_API_KEY' },
  qwen: { id:'qwen', protocol:'chat-completions', baseUrl:'https://ws-2t7yj3g991jc5yo6.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1', keyEnv:'DASHSCOPE_SINGAPORE_API_KEY' },
};

const definitions = [
  ['gpt-6-astra','GPT-6 Astra','openai','openrouter-responses','openai/gpt-6-astra',1000000,128000,{reasoning:{effort:'max',summary:'auto'},text:{verbosity:'high'},include:['reasoning.encrypted_content'],service_tier:'default'}],
  ['claude-opus-5','Claude Opus 5','anthropic','openrouter','claude-opus-5',1000000,128000,{reasoning:{effort:'max'},cache_control:{type:'ephemeral'}}],
  ['google/gemini-3.8-flash','Gemini 3.8 Flash','google','openrouter','google/gemini-3.8-flash',1000000,65536,{reasoning:{effort:'high'}}],
  ['grok-4.6','Grok 4.6','xai','openrouter','grok-4.6',256000,32768,{reasoning:{effort:'high'}}],
  ['kimi-k3','Kimi K3','moonshot','openrouter','kimi-k3',262144,131072,{}],
  ['qwen-3.8-max-0902','Qwen 3.8 Max 0902','qwen','qwen','qwen3.8-max-0902',262144,32768,{enable_thinking:true,preserve_thinking:false}],
];

export const MODEL_CONFIGS = definitions.map(([id,name,group,providerId,upstreamModel,contextWindow,maxOutputTokens,requestOptions],sortOrder) => ({
  id,name,group,provider:group,providerId,upstreamModel,contextWindow,maxOutputTokens,requestOptions,sortOrder,
  protocol:MODEL_PROVIDERS[providerId].protocol,
  enabled:true,isDefault:id===DEFAULT_MODEL_ID,isTranscriptionDefault:id===TRANSCRIPTION_MODEL_ID,
  supportsTools:true,supportsWebSearch:true,
  nativeInputs:group==='google'?['text','image','audio','video']:['text','image'],
  billingMode:group==='qwen'?'tokens':'upstream-cost',pricing:DEFAULT_RATES.chat[id],
}));
