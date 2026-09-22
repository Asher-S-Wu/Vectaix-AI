import { DEFAULT_RATES } from '@/lib/server/credits/constants';

export const DEFAULT_MODEL_ID = 'gpt-6-astra';
export const TRANSCRIPTION_MODEL_ID = 'google/gemini-3.8-flash';
const MICU_BASE_URL = 'https://www.micuapi.ai';
const CODEX_USER_AGENT = 'codex_cli_rs/0.77.0 (Windows 10.0.26100; x86_64) WindowsTerminal';
const CLAUDE_USER_AGENT = 'claude-cli/2.0.76 (external, cli)';
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:149.0) Gecko/20100101 Firefox/149.0';
export const MODEL_PROVIDERS = {
  'micu-gpt-6-astra': { id:'micu-gpt-6-astra', protocol:'responses', baseUrl:`${MICU_BASE_URL}/v1`, keyEnv:'MICU_OPENAI_API_KEY', headers:{'User-Agent':CODEX_USER_AGENT} },
  'micu-claude-opus-5': { id:'micu-claude-opus-5', protocol:'anthropic', baseUrl:`${MICU_BASE_URL}/v1`, keyEnv:'MICU_ANTHROPIC_API_KEY', headers:{'User-Agent':CLAUDE_USER_AGENT} },
  'micu-gemini-3.8-flash': { id:'micu-gemini-3.8-flash', protocol:'gemini', baseUrl:`${MICU_BASE_URL}/v1beta`, keyEnv:'MICU_GOOGLE_API_KEY' },
  'micu-grok-4.6': { id:'micu-grok-4.6', protocol:'responses', baseUrl:`${MICU_BASE_URL}/v1`, keyEnv:'MICU_XAI_API_KEY' },
  'micu-kimi-k3': { id:'micu-kimi-k3', protocol:'chat-completions', baseUrl:`${MICU_BASE_URL}/v1`, keyEnv:'MICU_MOONSHOT_API_KEY', headers:{'User-Agent':BROWSER_USER_AGENT} },
};

const definitions = [
  ['gpt-6-astra','GPT-6 Astra','openai','micu-gpt-6-astra','gpt-6-astra',1000000,128000,{reasoning:{effort:'max',summary:'auto'},text:{verbosity:'high'},include:['reasoning.encrypted_content'],service_tier:'default'}],
  ['claude-opus-5','Claude Opus 5','anthropic','micu-claude-opus-5','claude-opus-5',1000000,128000,{thinking:{type:'adaptive'},output_config:{effort:'max'},cache_control:{type:'ephemeral'}}],
  ['google/gemini-3.8-flash','Gemini 3.8 Flash','google','micu-gemini-3.8-flash','gemini-3.8-flash',1000000,65536,{generationConfig:{thinkingConfig:{thinkingLevel:'high',includeThoughts:true}}}],
  ['grok-4.6','Grok 4.6','xai','micu-grok-4.6','grok-4.6',256000,32768,{reasoning:{effort:'high'}}],
  ['kimi-k3','Kimi K3','moonshot','micu-kimi-k3','kimi-k3',262144,131072,{}],
];

export const MODEL_CONFIGS = definitions.map(([id,name,group,providerId,upstreamModel,contextWindow,maxOutputTokens,requestOptions],sortOrder) => ({
  id,name,group,provider:group,providerId,upstreamModel,contextWindow,maxOutputTokens,requestOptions,sortOrder,
  protocol:MODEL_PROVIDERS[providerId].protocol,
  enabled:true,isDefault:id===DEFAULT_MODEL_ID,isTranscriptionDefault:id===TRANSCRIPTION_MODEL_ID,
  supportsTools:true,supportsWebSearch:true,
  nativeInputs:group==='google'?['text','image','audio','video']:['text','image'],
  outputTokenParameter:group==='moonshot'?'max_tokens':'max_completion_tokens',
  billingMode:'tokens',pricing:DEFAULT_RATES.chat[id],
}));
