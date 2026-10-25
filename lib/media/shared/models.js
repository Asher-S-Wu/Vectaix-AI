import { translate } from "../../shared/i18n.mjs";

export const IMAGE_MODEL = "gpt-image-2.5-sunburst";

export const IMAGE_MODEL_NAME = "GPT Image 2.5";
export const MEDIA_MODELS = Object.freeze([
  Object.freeze({
    id: IMAGE_MODEL,
    name: IMAGE_MODEL_NAME,
    provider: "image-gen",
    group: "media",
    mediaType: "image",
    nativeInputs: ["text", "image"],
  }),
  Object.freeze({
    id: "gpt-image-2.5-flare",
    name: IMAGE_MODEL_NAME,
    provider: "image-gen",
    group: "media",
    mediaType: "image",
    nativeInputs: ["text", "image"],
  }),
]);

export const IMAGE_PROMPT_MAX_LENGTH = 32000;
const MICU_IMAGE_SIZES = Object.freeze([
  Object.freeze({ id: "auto", label: "自动" }),
  Object.freeze({ id: "1024x1024", label: "1:1 正方形 · 1K" }),
  Object.freeze({ id: "1280x720", label: "16:9 横版 · 1K" }),
  Object.freeze({ id: "720x1280", label: "9:16 竖版 · 1K" }),
  Object.freeze({ id: "1024x1536", label: "2:3 竖版 · 1K" }),
  Object.freeze({ id: "1536x1024", label: "3:2 横版 · 1K" }),
  Object.freeze({ id: "1152x864", label: "4:3 横版 · 1K" }),
  Object.freeze({ id: "864x1152", label: "3:4 竖版 · 1K" }),
  Object.freeze({ id: "1344x576", label: "21:9 超宽 · 1K" }),
  Object.freeze({ id: "2048x2048", label: "1:1 正方形 · 2K" }),
  Object.freeze({ id: "2048x1152", label: "16:9 横版 · 2K" }),
  Object.freeze({ id: "1152x2048", label: "9:16 竖版 · 2K" }),
  Object.freeze({ id: "3840x2160", label: "16:9 横版 · 4K（实验性）" }),
  Object.freeze({ id: "2160x3840", label: "9:16 竖版 · 4K（实验性）" }),
]);
const IMAGE_SIZE_LABELS_EN = Object.freeze({
  auto: "Automatic",
  "1024x1024": "1:1 Square · 1K",
  "1280x720": "16:9 Landscape · 1K",
  "720x1280": "9:16 Portrait · 1K",
  "1024x1536": "2:3 Portrait · 1K",
  "1536x1024": "3:2 Landscape · 1K",
  "1152x864": "4:3 Landscape · 1K",
  "864x1152": "3:4 Portrait · 1K",
  "1344x576": "21:9 Ultrawide · 1K",
  "2048x2048": "1:1 Square · 2K",
  "2048x1152": "16:9 Landscape · 2K",
  "1152x2048": "9:16 Portrait · 2K",
  "3840x2160": "16:9 Landscape · 4K (experimental)",
  "2160x3840": "9:16 Portrait · 4K (experimental)",
});
const MICU_IMAGE_OPTIONS = Object.freeze({
  service: "micu",
  sizes: MICU_IMAGE_SIZES,
  defaultSize: "1024x1024",
  fixedQuality: "low",
  maxReferenceImages: 10,
  maxImageBytes: 4 * 1024 * 1024,
  maxTotalImageBytes: 8 * 1024 * 1024,
  mimeTypes: Object.freeze(["image/png", "image/jpeg", "image/webp"]),
  extensions: Object.freeze(["png", "jpg", "jpeg", "webp"]),
  promptMaxLength: IMAGE_PROMPT_MAX_LENGTH,
});

export const IMAGE_MODELS = Object.freeze([
  Object.freeze({
    ...MICU_IMAGE_OPTIONS,
    id: IMAGE_MODEL,
    name: IMAGE_MODEL_NAME,
  }),
  Object.freeze({
    ...MICU_IMAGE_OPTIONS,
    id: "gpt-image-2.5-flare",
    name: IMAGE_MODEL_NAME,
  }),
]);

export const IMAGE_MODEL_OPTIONS = Object.freeze([
  Object.freeze({
    id: IMAGE_MODEL,
    name: IMAGE_MODEL_NAME,
    modes: Object.freeze([
      Object.freeze({ id: IMAGE_MODEL, label: "质量" }),
      Object.freeze({ id: "gpt-image-2.5-flare", label: "速度" }),
    ]),
  }),
]);

function imageValidationError(message) {
  return Object.assign(new Error(message), { status: 400 });
}

export function getImageModelOption(id, locale = "zh") {
  const option = IMAGE_MODEL_OPTIONS.find((item) => item.id === id || item.modes.some((mode) => mode.id === id));
  if (!option) throw imageValidationError(translate(locale, "请选择支持的图片模型", "Choose a supported image model"));
  if (locale === "zh") return option;
  return { ...option, modes: option.modes.map(mode => ({ ...mode, label: translate(locale, mode.label, mode.id.endsWith("flare") ? "Speed" : "Quality") })) };
}

export function getImageModelConfig(id, locale = "zh") {
  const config = IMAGE_MODELS.find((model) => model.id === id);
  if (!config) throw imageValidationError(translate(locale, "请选择支持的图片模型", "Choose a supported image model"));
  if (locale === "zh") return config;
  return { ...config, sizes: config.sizes.map(size => ({ ...size, label: translate(locale, size.label, IMAGE_SIZE_LABELS_EN[size.id]) })) };
}

export const IMAGE_COUNT_OPTIONS = Object.freeze([1, 2, 3, 4].map(id => Object.freeze({ id, label: `${id} 张` })));

export function getImageCountOptions(locale) {
  return IMAGE_COUNT_OPTIONS.map(option => ({ ...option, label: translate(locale, "{count} 张", option.id === 1 ? "{count} image" : "{count} images", { count: option.id }) }));
}

export function validateImageOptions({ model, size, count = 1 } = {}, locale = "zh") {
  if (!Number.isInteger(count) || count < 1 || count > 4) throw imageValidationError(translate(locale, "图片数量必须是 1 至 4 的整数", "Choose a whole number of images from 1 to 4"));
  const config = getImageModelConfig(model, locale);
  if (!config.sizes.some((option) => option.id === size)) {
    throw imageValidationError(translate(locale, "请为 {model} 重新选择图片尺寸", "Choose a valid image size for {model}", { model: config.name }));
  }
  return { model, size, quality: config.fixedQuality, count };
}

export function validateImageReferences(model, images, { requireImages = false, locale = "zh" } = {}) {
  const config = getImageModelConfig(model, locale);
  if (!Array.isArray(images)) throw imageValidationError(translate(locale, "参考图片列表无效", "The reference image list is invalid"));
  if (requireImages && images.length === 0) {
    throw imageValidationError(translate(locale, "请至少选择一张参考图片", "Choose at least one reference image"));
  }
  if (images.length > config.maxReferenceImages) {
    throw imageValidationError(translate(locale, "{model} 最多可选择 {count} 张参考图片", "Choose up to {count} reference images for {model}", { model: config.name, count: config.maxReferenceImages }));
  }

  let totalBytes = 0;
  for (const file of images) {
    if (!file || typeof file.name !== "string" || !file.name.trim() || typeof file.type !== "string" || !Number.isSafeInteger(file.size) || file.size <= 0) {
      throw imageValidationError(translate(locale, "参考图片信息无效，请重新选择图片", "The reference image is invalid. Choose the image again."));
    }
    const extension = file.name.match(/\.([^.]+)$/)?.[1].toLowerCase();
    if (!config.extensions.includes(extension) || (file.type !== "" && !config.mimeTypes.includes(file.type))) {
      throw imageValidationError(translate(locale, "请将“{name}”转为 {formats} 格式后上传至 {model}", "Convert “{name}” to {formats} before uploading to {model}", { name: file.name, formats: config.extensions.join(", ").toUpperCase(), model: config.name }));
    }
    if (file.size > config.maxImageBytes) {
      throw imageValidationError(translate(locale, "“{name}”超过 {size} MB，请压缩后再上传", "“{name}” exceeds {size} MB. Compress it before uploading.", { name: file.name, size: config.maxImageBytes / (1024 * 1024) }));
    }
    totalBytes += file.size;
  }
  if (totalBytes > config.maxTotalImageBytes) {
    throw imageValidationError(translate(locale, "{model} 的参考图片合计最多 {size} MB", "Reference images for {model} can total up to {size} MB", { model: config.name, size: config.maxTotalImageBytes / (1024 * 1024) }));
  }
  return images;
}
