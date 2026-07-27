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

function ProviderMark({ provider, size }) {
  if (provider === "image-gen") {
    return <ImagePlus aria-hidden style={{ width: size, height: size }} />;
  }
  if (provider === "video-gen") {
    return <Clapperboard aria-hidden style={{ width: size, height: size }} />;
  }
  const logo = PROVIDER_LOGOS[provider] || PROVIDER_LOGOS.openai;
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 bg-contain bg-center bg-no-repeat"
      style={{ width: size, height: size, backgroundImage: `url("${logo}")` }}
    />
  );
}

export function ModelGlyph({ model, provider, size = 16 }) {
  return <ProviderMark provider={provider || getModelProvider(model)} size={size} />;
}

export function ModelAvatar({ model, size = 24 }) {
  return <ProviderMark provider={getModelProvider(model)} size={size} />;
}
