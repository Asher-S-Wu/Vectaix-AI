import { normalizeWebSearchSettings } from "@/lib/shared/webSearch";

export function buildChatConfig({
  images,
  attachments,
  webSearch,
  systemPromptSuffix,
  size,
  resolution,
} = {}) {
  const cfg = {};

  cfg.webSearch = normalizeWebSearchSettings(webSearch, { defaultEnabled: true });
  if (typeof systemPromptSuffix === "string" && systemPromptSuffix.trim()) {
    cfg.systemPromptSuffix = systemPromptSuffix;
  }

  if (Array.isArray(images) && images.length > 0) {
    cfg.images = images
      .filter((item) => typeof item?.url === "string" && item.url)
      .map((item) => ({
        ...(typeof item?.fileId === "string" && item.fileId ? { fileId: item.fileId } : {}),
        url: item.url,
        ...(typeof item?.mimeType === "string" && item.mimeType
          ? { mimeType: item.mimeType }
          : {}),
      }));
    cfg.mediaResolution = "media_resolution_high";
  }

  if (Array.isArray(attachments) && attachments.length > 0) {
    cfg.attachments = attachments;
  }

  if (typeof size === "string" && size) cfg.size = size;
  if (typeof resolution === "string" && resolution) cfg.resolution = resolution;

  return cfg;
}
