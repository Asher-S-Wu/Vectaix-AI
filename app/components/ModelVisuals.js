import {
  COUNCIL_MODEL_ID,
  getModelProvider,
  isCouncilModel,
  isSeedModel,
} from "@/lib/shared/models";

const PROVIDER_ICONS = {
  gemini: "https://cdn.marmot-cloud.com/storage/zenmux/2025/12/25/XQVLSt6/Gemini-model-logo.svg",
  claude: "https://cdn.marmot-cloud.com/storage/zenmux/2025/10/15/dzvOyI0/Property-1Claude.svg",
  openai: "https://cdn.marmot-cloud.com/storage/zenmux/2025/10/15/Mm7IePA/Property-1GPT.svg",
  seed: "https://cdn.marmot-cloud.com/storage/zenmux/2025/11/11/OXR17nY/Property-1seed.svg",
  deepseek: "https://cdn.marmot-cloud.com/storage/zenmux/2025/10/15/tmeJLqx/Property-1deepseek.svg",
  "image-gen": "https://cdn.marmot-cloud.com/storage/zenmux/2025/10/15/Mm7IePA/Property-1GPT.svg",
};

const COUNCIL_PROVIDERS = ["openai", "claude", "gemini", "seed"];

function resolveProvider(model, provider) {
  if (provider) return provider;
  if (isCouncilModel(model)) return "council";
  if (isSeedModel(model)) return "seed";
  return getModelProvider(model);
}

function ProviderGlyph({ provider, size }) {
  const src = PROVIDER_ICONS[provider] || PROVIDER_ICONS.gemini;
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
  const src = PROVIDER_ICONS[provider] || PROVIDER_ICONS.gemini;
  return (
    <img
      src={src}
      alt=""
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.17) }}
      className="shrink-0 object-cover"
    />
  );
}

function CouncilComposite({ size = 16, avatar = false }) {
  const gap = Math.max(1, Math.round(size * 0.08));
  const tileSize = Math.max(6, Math.floor((size - gap) / 2));

  return (
    <span
      className="inline-grid shrink-0"
      style={{
        width: size,
        height: size,
        gridTemplateColumns: `repeat(2, ${tileSize}px)`,
        gridTemplateRows: `repeat(2, ${tileSize}px)`,
        gap,
      }}
      aria-hidden="true"
    >
      {COUNCIL_PROVIDERS.map((providerName) => (
        <span
          key={providerName}
          className="inline-flex items-center justify-center overflow-hidden"
          style={{ width: tileSize, height: tileSize, borderRadius: avatar ? Math.max(3, Math.round(tileSize * 0.28)) : 0 }}
        >
          {avatar ? <ProviderAvatar provider={providerName} size={tileSize} /> : <ProviderGlyph provider={providerName} size={tileSize} />}
        </span>
      ))}
    </span>
  );
}

export function ModelGlyph({ model, provider, size = 16 }) {
  if (model === COUNCIL_MODEL_ID) {
    return <CouncilComposite size={size} />;
  }

  const resolvedProvider = resolveProvider(model, provider);

  if (resolvedProvider === "council") {
    return <CouncilComposite size={size} />;
  }

  return <ProviderGlyph provider={resolvedProvider} size={size} />;
}

export function ModelAvatar({ model, size = 24 }) {
  if (model === COUNCIL_MODEL_ID) {
    return <CouncilComposite size={size} avatar />;
  }

  const provider = resolveProvider(model);

  if (provider === "council") {
    return <CouncilComposite size={size} avatar />;
  }

  return <ProviderAvatar provider={provider} size={size} />;
}
