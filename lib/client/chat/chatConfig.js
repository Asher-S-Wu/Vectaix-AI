import { getModelConfig } from "@/lib/shared/models";
import { normalizeWebSearchSettings } from "@/lib/shared/webSearch";

export function buildChatConfig({
  modelId,
  thinkingLevel,
  mediaResolution,
  imageUrls,
  images,
  attachments,
  maxTokens,
  webSearch,
  systemPromptSuffix,
  size,
  resolution,
} = {}) {
  const modelConfig = getModelConfig(modelId);
  const cfg = {};

  if (modelConfig?.supportsThinkingLevelControl === true && typeof thinkingLevel === "string" && thinkingLevel) {
    cfg.thinkingLevel = thinkingLevel;
  }
  if (modelConfig?.supportsMaxTokensControl === true && Number.isFinite(Number(maxTokens)) && Number(maxTokens) > 0) {
    cfg.maxTokens = maxTokens;
  }
  if (modelConfig?.supportsWebSearch === true) {
    cfg.webSearch = normalizeWebSearchSettings(webSearch, { defaultEnabled: true });
  }
  if (typeof systemPromptSuffix === "string" && systemPromptSuffix.trim()) {
    cfg.systemPromptSuffix = systemPromptSuffix;
  }

  if (Array.isArray(images) && images.length > 0) {
    cfg.images = images
      .filter((item) => typeof item?.url === "string" && item.url)
      .map((item) => ({
        url: item.url,
        ...(typeof item?.mimeType === "string" && item.mimeType
          ? { mimeType: item.mimeType }
          : {}),
      }));
    cfg.mediaResolution = mediaResolution;
  } else if (imageUrls?.length > 0) {
    cfg.images = imageUrls.map((url) => ({ url }));
    cfg.mediaResolution = mediaResolution;
  }

  if (Array.isArray(attachments) && attachments.length > 0) {
    cfg.attachments = attachments;
  }

  if (typeof size === "string" && size) cfg.size = size;
  if (typeof resolution === "string" && resolution) cfg.resolution = resolution;

  return cfg;
}
