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

export function getImageModelOption(id) {
  const option = IMAGE_MODEL_OPTIONS.find((item) => item.id === id || item.modes.some((mode) => mode.id === id));
  if (!option) throw imageValidationError("请选择支持的图片模型");
  return option;
}

export function getImageModelConfig(id) {
  const config = IMAGE_MODELS.find((model) => model.id === id);
  if (!config) throw imageValidationError("请选择支持的图片模型");
  return config;
}

export const IMAGE_COUNT_OPTIONS = Object.freeze([1, 2, 3, 4].map(id => Object.freeze({ id, label: `${id} 张` })));

export function validateImageOptions({ model, size, count = 1 } = {}) {
  if (!Number.isInteger(count) || count < 1 || count > 4) throw imageValidationError("图片数量必须是 1 至 4 的整数");
  const config = getImageModelConfig(model);
  if (!config.sizes.some((option) => option.id === size)) {
    throw imageValidationError(`${config.name} 不支持所选图片尺寸，请重新选择`);
  }
  return { model, size, quality: config.fixedQuality, count };
}

export function validateImageReferences(model, images, { requireImages = false } = {}) {
  const config = getImageModelConfig(model);
  if (!Array.isArray(images)) throw imageValidationError("参考图片列表无效");
  if (requireImages && images.length === 0) {
    throw imageValidationError("请至少选择一张参考图片");
  }
  if (images.length > config.maxReferenceImages) {
    throw imageValidationError(`${config.name} 最多可选择 ${config.maxReferenceImages} 张参考图片`);
  }

  let totalBytes = 0;
  for (const file of images) {
    if (!file || typeof file.name !== "string" || !file.name.trim() || typeof file.type !== "string" || !Number.isSafeInteger(file.size) || file.size <= 0) {
      throw imageValidationError("参考图片信息无效，请重新选择图片");
    }
    const extension = file.name.match(/\.([^.]+)$/)?.[1].toLowerCase();
    if (!config.extensions.includes(extension) || (file.type !== "" && !config.mimeTypes.includes(file.type))) {
      throw imageValidationError(`${config.name} 不支持“${file.name}”的格式，请选择 ${config.extensions.join("、").toUpperCase()} 图片`);
    }
    if (file.size > config.maxImageBytes) {
      throw imageValidationError(`“${file.name}”超过 ${config.maxImageBytes / (1024 * 1024)}MB，请压缩后再上传`);
    }
    totalBytes += file.size;
  }
  if (totalBytes > config.maxTotalImageBytes) {
    throw imageValidationError(`${config.name} 参考图片合计不能超过 ${config.maxTotalImageBytes / (1024 * 1024)}MB`);
  }
  return images;
}
