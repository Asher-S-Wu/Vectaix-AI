import { getModelProvider } from "@/lib/shared/models";

const FUSION_MODEL_IDS = new Set(["fusion", "openrouter/fusion"]);

function isFusionVisual(model, provider) {
  return provider === "fusion" || (typeof model === "string" && FUSION_MODEL_IDS.has(model.trim()));
}

function FusionGlyph({ size = 16 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.6} className="shrink-0" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z" />
    </svg>
  );
}

const PROVIDER_MARKS = Object.freeze({
  openai: { label: "O", background: "#111827", color: "#ffffff" },
  anthropic: { label: "A", background: "#d97757", color: "#ffffff" },
  google: { label: "G", background: "linear-gradient(135deg,#4285f4,#34a853,#fbbc05,#ea4335)", color: "#ffffff" },
  xai: { label: "x", background: "#050505", color: "#ffffff" },
  zai: { label: "Z", background: "#315efb", color: "#ffffff" },
  openrouter: { label: "OR", background: "#6d28d9", color: "#ffffff" },
});

function ProviderMark({ provider, size }) {
  const mark = PROVIDER_MARKS[provider] || PROVIDER_MARKS.openai;
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center font-bold leading-none"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.22), background: mark.background, color: mark.color, fontSize: Math.max(8, Math.round(size * 0.5)) }}
    >
      {mark.label}
    </span>
  );
}

export function ModelGlyph({ model, provider, size = 16 }) {
  if (isFusionVisual(model, provider)) return <FusionGlyph size={size} />;
  return <ProviderMark provider={provider || getModelProvider(model)} size={size} />;
}

export function ModelAvatar({ model, size = 24 }) {
  if (isFusionVisual(model)) {
    return <span className="inline-flex shrink-0 items-center justify-center text-zinc-700 dark:text-zinc-200" style={{ width: size, height: size }}><FusionGlyph size={Math.round(size * 0.82)} /></span>;
  }
  return <ProviderMark provider={getModelProvider(model)} size={size} />;
}
