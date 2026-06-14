import {
  getModelProvider,
} from "@/lib/shared/models";

const PROVIDER_ICONS = {
  google: "https://cdn.marmot-cloud.com/storage/zenmux/2025/12/25/XQVLSt6/Gemini-model-logo.svg",
  anthropic: "https://cdn.marmot-cloud.com/storage/zenmux/2025/10/15/dzvOyI0/Property-1Claude.svg",
  openai: "https://cdn.marmot-cloud.com/storage/zenmux/2025/10/15/Mm7IePA/Property-1GPT.svg",
  deepseek: "https://cdn.marmot-cloud.com/storage/zenmux/2025/10/15/tmeJLqx/Property-1deepseek.svg",
  gemini: "https://cdn.marmot-cloud.com/storage/zenmux/2025/12/25/XQVLSt6/Gemini-model-logo.svg",
  claude: "https://cdn.marmot-cloud.com/storage/zenmux/2025/10/15/dzvOyI0/Property-1Claude.svg",
};

function resolveProvider(model, provider) {
  if (provider) return provider;
  return getModelProvider(model);
}

function ProviderGlyph({ provider, size }) {
  const src = PROVIDER_ICONS[provider] || PROVIDER_ICONS.openai;
  return (
    <img
      src={src}
      alt=""
      style={{ width: size, height: size }}
      className="shrink-0"
    />
  );
}

function ProviderAvatar({ provider, size = 24 }) {
  const src = PROVIDER_ICONS[provider] || PROVIDER_ICONS.openai;
  return (
    <img
      src={src}
      alt=""
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.17) }}
      className="shrink-0 object-cover"
    />
  );
}

export function ModelGlyph({ model, provider, size = 16 }) {
  const resolvedProvider = resolveProvider(model, provider);
  return <ProviderGlyph provider={resolvedProvider} size={size} />;
}

export function ModelAvatar({ model, size = 24 }) {
  const provider = resolveProvider(model);
  return <ProviderAvatar provider={provider} size={size} />;
}
