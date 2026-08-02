import { resolveQwenImageConfig } from "@/lib/modelRoutes";
import {
  IMAGE_EDIT_MAX_COUNT,
  IMAGE_MODEL,
} from "@/lib/media/shared/models";
import { saveMediaFromUrl } from "@/lib/media/storage";

function createServiceError(message, status = 502, details = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, details);
  return error;
}

function toSafeUpstreamStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502;
}

function createQwenResponseError(response, data) {
  const code = typeof data?.code === "string" ? data.code.trim() : "";
  const requestId = typeof data?.request_id === "string" ? data.request_id.trim() : "";
  const normalizedCode = code.toLowerCase();
  let message;

  if (normalizedCode.includes("invalidapikey") || response.status === 401) {
    message = "千问图片服务的 API 密钥无效";
  } else if (
    normalizedCode.includes("accessdenied")
    || normalizedCode.includes("permission")
    || response.status === 403
  ) {
    message = "尚未开通 Qwen Image 3.0 Pro 模型权限";
  } else if (response.status === 429) {
    message = "千问图片服务请求过于频繁，请稍后再试";
  } else {
    const upstreamMessage = typeof data?.message === "string" ? data.message.trim() : "";
    message = upstreamMessage || `千问图片服务请求失败（${response.status}）`;
  }

  return createServiceError(message, toSafeUpstreamStatus(response.status), {
    code,
    requestId,
  });
}

async function readResponseJson(response) {
  try {
    return await response.json();
  } catch {
    throw createServiceError("千问图片服务返回了无法识别的结果");
  }
}

async function encodeReferenceImage(image) {
  if (!(image instanceof File)) {
    throw createServiceError("参考图片无效", 400);
  }
  const base64 = Buffer.from(await image.arrayBuffer()).toString("base64");
  return {
    image: `data:${image.type};base64,${base64}`,
  };
}

function buildParameters(size) {
  const parameters = {
    prompt_extend: true,
    n: 1,
    watermark: false,
  };
  if (size !== "auto") {
    parameters.size = String(size).replace("x", "*");
  }
  return parameters;
}

function findGeneratedImageUrl(data) {
  const choices = Array.isArray(data?.output?.choices) ? data.output.choices : [];
  for (const choice of choices) {
    const content = Array.isArray(choice?.message?.content) ? choice.message.content : [];
    for (const item of content) {
      if (typeof item?.image === "string" && item.image.trim()) {
        return item.image.trim();
      }
    }
  }
  return "";
}

async function requestQwenImage({ prompt, images, size, signal }) {
  const { apiKey, endpoint } = resolveQwenImageConfig();
  const content = [];
  for (const image of images) {
    content.push(await encodeReferenceImage(image));
  }
  content.push({ text: prompt });

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        input: {
          messages: [{ role: "user", content }],
        },
        parameters: buildParameters(size),
      }),
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw createServiceError("暂时无法连接千问图片服务");
  }

  const data = await readResponseJson(response);
  if (!response.ok || data?.code) {
    throw createQwenResponseError(response, data);
  }

  const imageUrl = findGeneratedImageUrl(data);
  if (!imageUrl) {
    throw createServiceError("图片处理完成，但千问没有返回图片");
  }
  return imageUrl;
}

async function createAndStoreImage({
  userId,
  prompt,
  images = [],
  size,
  ownerType,
  ownerId,
  signal,
  mediaWriteLease,
}) {
  if (images.length > IMAGE_EDIT_MAX_COUNT) {
    throw createServiceError(`最多支持 ${IMAGE_EDIT_MAX_COUNT} 张参考图片`, 400);
  }
  const remoteUrl = await requestQwenImage({ prompt, images, size, signal });
  return saveMediaFromUrl({
    userId,
    url: remoteUrl,
    mimeType: "image/png",
    ownerType,
    ownerId,
    signal,
    mediaWriteLease,
  });
}

export async function generateAndStoreImage({
  userId,
  prompt,
  size = "auto",
  signal,
  mediaWriteLease,
}) {
  const saved = await generateAndStoreImageFile({
    userId,
    prompt,
    size,
    ownerType: "image-result",
    ownerId: userId,
    signal,
    mediaWriteLease,
  });
  return saved.url;
}

export function generateAndStoreImageFile({
  userId,
  prompt,
  size = "auto",
  ownerType,
  ownerId,
  signal,
  mediaWriteLease,
}) {
  return createAndStoreImage({
    userId,
    prompt,
    images: [],
    size,
    ownerType,
    ownerId,
    signal,
    mediaWriteLease,
  });
}

export async function editAndStoreImage({
  userId,
  prompt,
  images,
  size = "auto",
  signal,
  mediaWriteLease,
}) {
  const saved = await editAndStoreImageFile({
    userId,
    prompt,
    images,
    size,
    ownerType: "image-result",
    ownerId: userId,
    signal,
    mediaWriteLease,
  });
  return saved.url;
}

export function editAndStoreImageFile({
  userId,
  prompt,
  images,
  size = "auto",
  ownerType,
  ownerId,
  signal,
  mediaWriteLease,
}) {
  if (!Array.isArray(images) || images.length === 0) {
    throw createServiceError("请上传需要编辑的参考图片", 400);
  }
  return createAndStoreImage({
    userId,
    prompt,
    images,
    size,
    ownerType,
    ownerId,
    signal,
    mediaWriteLease,
  });
}
