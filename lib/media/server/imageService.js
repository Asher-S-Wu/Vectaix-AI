import crypto from "node:crypto";
import { getImageModelConfig, validateImageOptions, validateImageReferences } from "@/lib/media/shared/models";
import { getFileExtension } from "@/lib/shared/attachments";
import { inspectUploadedFile } from "@/lib/server/storage/fileInspection";
import { resolveMicuImageConfig, resolveQwenImageConfig } from "@/lib/modelRoutes";
import { generateAndStoreImageFile, editAndStoreImageFile } from "./qwenImage";
import { generateAndStoreMicuImageFile } from "./micuImage";
import { calculateGptImageCost, calculateQwenImageCost } from "@/lib/server/credits/pricing";
import { releaseMediaCredits, reviewMediaCredits, settleMediaCredits } from "./billing";

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

export async function finalizeImageBilling({ reservation, options, inputImageCount, outcomes }) {
  const usage = { ...reservation.transaction.usage, ...imageBillingUsage(options, inputImageCount), imageOutcomes: outcomes };
  const attempts = outcomes.flatMap(item => item.attempts);
  const upstreamRequestIds = [...new Set(attempts.map(item => item.requestId).filter(Boolean))];
  const details = { reservation, operationId: reservation.transaction.operationId, usage, upstreamRequestIds };
  const uncertain = attempts.some(item => !item.success && item.dispatched && !item.upstreamRejected);
  if (uncertain) return reviewMediaCredits({ ...details, reason: "图片请求存在未能确认的结果，费用待核对" });
  const completed = attempts.filter(item => item.success);
  if (!completed.length) return releaseMediaCredits(details);
  const actual = { costCny: 0, costUsd: 0 };
  try {
    for (const attempt of completed) {
      const priced = getImageModelConfig(options.model).service === "micu"
        ? calculateGptImageCost({ model: options.model, usage: attempt.usage }, reservation.settings)
        : calculateQwenImageCost(usage, reservation.settings);
      actual.costCny += priced.costCny;
      if (priced.costUsd === null) actual.costUsd = null;
      else if (actual.costUsd !== null) actual.costUsd += priced.costUsd;
    }
  } catch (error) {
    return reviewMediaCredits({ ...details, reason: `图片已生成，费用待核对：${error.message}` });
  }
  return settleMediaCredits({ ...details, actual });
}

export async function createAndStoreImageFiles({ count = 1, onRequestDispatched, onFileSaved, ...input }) {
  const options = validateImageOptions({ ...input, count });
  const slots = await Promise.all(Array.from({ length: options.count }, async (_, index) => {
    let dispatched = false;
    let attempts = [];
    try {
      const saved = await createAndStoreImageFile({
        ...input,
        onRequestDispatched: () => { dispatched = true; onRequestDispatched?.(); },
        onUpstreamComplete: completed => {
          attempts = completed.attempts || [{ success: true, requestId: completed.requestId, usage: completed.usage }];
        },
      });
      onFileSaved?.(saved);
      const { fileId, url, mimeType, name, size } = saved;
      return { result: { success: true, fileId, url, mimeType, name, size }, outcome: { index, attempts } };
    } catch (error) {
      if (!attempts.length) attempts = error.attempts || [{ success: false, dispatched, requestId: error.requestId, code: error.code, status: error.status, upstreamRejected: error.upstreamRejected === true }];
      return {
        result: { success: false, message: error.message, status: error.status || 500 },
        outcome: { index, attempts },
      };
    }
  }));
  return { results: slots.map(slot => slot.result), outcomes: slots.map(slot => slot.outcome) };
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
