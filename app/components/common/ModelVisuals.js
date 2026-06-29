import {
  getModelProvider,
} from "@/lib/shared/models";

const FUSION_MODEL_IDS = new Set(["fusion", "openrouter/fusion"]);

function isFusionVisual(model, provider) {
  if (provider === "fusion") return true;
  if (typeof model === "string" && FUSION_MODEL_IDS.has(model.trim())) return true;
  return false;
}

function FusionGlyph({ size = 16 }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      className="shrink-0"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
      />
    </svg>
  );
}

const PROVIDER_ICONS = {
  google: "https://cdn.marmot-cloud.com/storage/zenmux/2025/12/25/XQVLSt6/Gemini-model-logo.svg",
  anthropic: "https://cdn.marmot-cloud.com/storage/zenmux/2025/10/15/dzvOyI0/Property-1Claude.svg",
  openai: "https://cdn.marmot-cloud.com/storage/zenmux/2025/10/15/Mm7IePA/Property-1GPT.svg",
  openrouter: "https://cdn.marmot-cloud.com/storage/zenmux/2025/10/15/Mm7IePA/Property-1GPT.svg",
  ark: "https://cdn.marmot-cloud.com/storage/zenmux/2026/04/08/YSFtnJU/Property-1Bytedance.svg",
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
  if (isFusionVisual(model, provider)) {
    return <FusionGlyph size={size} />;
  }
  const resolvedProvider = resolveProvider(model, provider);
  return <ProviderGlyph provider={resolvedProvider} size={size} />;
}

export function ModelAvatar({ model, size = 24 }) {
  if (isFusionVisual(model)) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center text-zinc-700 dark:text-zinc-200"
        style={{ width: size, height: size }}
      >
        <FusionGlyph size={Math.round(size * 0.82)} />
      </span>
    );
  }
  const provider = resolveProvider(model);
  return <ProviderAvatar provider={provider} size={size} />;
}
