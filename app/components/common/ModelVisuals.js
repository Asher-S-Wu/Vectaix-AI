"use client";

import { useState } from "react";
import { Clapperboard, ImagePlus } from "lucide-react";
import { getModelProvider } from "@/lib/shared/models";

const PROVIDER_LOGOS = Object.freeze({
  aihubmix: "https://assets.aihubmix.com/logos/logo.png",
  openai: "https://assets.aihubmix.com/logos_svg/logo_GPT.svg",
  anthropic: "https://assets.aihubmix.com/logos_svg/logo_claude2.svg",
  google: "https://assets.aihubmix.com/logos/logo_gemini.svg",
  xai: "https://assets.aihubmix.com/logos_svg/logo_Grok.svg",
  moonshot: "https://assets.aihubmix.com/logos_svg/logo_kimi.svg",
});

// Logos that are solid black and invisible on dark backgrounds
const DARK_INVERT_PROVIDERS = new Set(["openai", "xai"]);

function FallbackMark({ provider, size }) {
  const letter = (typeof provider === "string" && provider ? provider[0] : "?").toUpperCase();
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-sm bg-primary/15 font-bold text-primary"
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.62)) }}
    >
      {letter}
    </span>
  );
}

function ProviderMark({ provider, size }) {
  const [failed, setFailed] = useState(false);
  if (provider === "image-gen") {
    return <ImagePlus aria-hidden style={{ width: size, height: size }} />;
  }
  if (provider === "video-gen") {
    return <Clapperboard aria-hidden style={{ width: size, height: size }} />;
  }
  const logo = PROVIDER_LOGOS[provider];
  if (!logo || failed) {
    return <FallbackMark provider={provider} size={size} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      aria-hidden
      src={logo}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`inline-block shrink-0 object-contain ${DARK_INVERT_PROVIDERS.has(provider) ? "dark:invert" : ""}`}
      style={{ width: size, height: size }}
    />
  );
}

export function ModelGlyph({ model, provider, size = 16 }) {
  return <ProviderMark provider={provider || getModelProvider(model)} size={size} />;
}

export function ModelAvatar({ model, size = 24 }) {
  return <ProviderMark provider={getModelProvider(model)} size={size} />;
}
