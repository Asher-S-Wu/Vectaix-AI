import crypto from "node:crypto";
import { getImageModelConfig, validateImageOptions, validateImageReferences } from "@/lib/media/shared/models";
import { getFileExtension } from "@/lib/shared/attachments";
import { inspectUploadedFile } from "@/lib/server/storage/fileInspection";
import { resolveMicuImageConfig, resolveQwenImageConfig } from "@/lib/modelRoutes";
import { generateAndStoreImageFile, editAndStoreImageFile } from "./qwenImage";
import { generateAndStoreMicuImageFile } from "./micuImage";
import { calculateGptImageCost, calculateQwenImageCost } from "@/lib/server/credits/pricing";
import { reviewMediaCredits, settleMediaCredits } from "./billing";

function invalidImage(message) {
  return Object.assign(new Error(message), { status: 400 });
}

export function resolveImageServiceConfig(model) {
  return getImageModelConfig(model).service === "micu" ? resolveMicuImageConfig() : resolveQwenImageConfig();
}

export function getImageFeature(model, edit = false) {
  return `${getImageModelConfig(model).service}_image_${edit ? "edit" : "generate"}`;
}

export function validateImagePrompt(model, prompt) {
  if (typeof prompt !== "string" || !prompt.trim()) throw invalidImage("请输入图片描述");
  const { promptMaxLength } = getImageModelConfig(model);
  if (prompt.trim().length > promptMaxLength) throw invalidImage(`图片描述最多支持 ${promptMaxLength} 个字符`);
  return prompt.trim();
}

export async function prepareImageRequest(body, { edit = false } = {}) {
  const options = validateImageOptions(body);
  const prompt = validateImagePrompt(options.model, body.prompt);
  const images = edit ? body.images : [];
  validateImageReferences(options.model, images, { requireImages: edit });
  const normalizedImages = [];
  const imageDigests = [];
  for (const image of images) {
    if (!(image instanceof File)) throw invalidImage("参考图片无效");
    const input = Buffer.from(await image.arrayBuffer());
    const inspected = inspectUploadedFile(input, getFileExtension(image.name));
    if (!inspected) throw invalidImage("图片内容与文件格式不一致");
    normalizedImages.push(new File([input], image.name, { type: inspected.mimeType }));
    imageDigests.push(crypto.createHash("sha256").update(input).digest("hex"));
  }
  validateImageReferences(options.model, normalizedImages, { requireImages: edit });
  return { options, prompt, images: normalizedImages, imageDigests };
}

export function imageBillingUsage(options, inputImageCount) {
  const config = getImageModelConfig(options.model);
  return {
    ...options,
    inputImageCount,
    ...(config.service === "qwen" ? { resolution: options.size === "auto" ? "2K" : "1K" } : { pricingSource: "openai" }),
  };
}

export async function finalizeImageBilling({ reservation, options, inputImageCount, upstreamUsage, upstreamRequestIds }) {
  const usage = {
    ...reservation.transaction.usage,
    ...imageBillingUsage(options, inputImageCount),
    ...(upstreamUsage === undefined ? {} : { upstreamUsage }),
  };
  const operationId = reservation.transaction.operationId;
  let actual;
  try {
    actual = getImageModelConfig(options.model).service === "micu"
      ? calculateGptImageCost({ model: options.model, usage: upstreamUsage }, reservation.settings)
      : calculateQwenImageCost(usage, reservation.settings);
  } catch (error) {
    return reviewMediaCredits({ operationId, usage, upstreamRequestIds, reason: `图片已生成，费用待核对：${error.message}` });
  }
  return settleMediaCredits({ reservation, operationId, actual, usage, upstreamRequestIds });
}

export async function createAndStoreImageFile({ model, prompt, size, quality, images = [], ...context }) {
  const options = validateImageOptions({ model, size, quality });
  validateImagePrompt(model, prompt);
  validateImageReferences(model, images);
  if (getImageModelConfig(model).service === "micu") {
    return generateAndStoreMicuImageFile({ ...context, ...options, prompt, images });
  }
  const generate = images.length ? editAndStoreImageFile : generateAndStoreImageFile;
  return generate({ ...context, prompt, size, images });
}
