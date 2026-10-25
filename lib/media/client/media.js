import { creditOperationHeaders } from "@/lib/client/credits/operations";
import { clientText } from "@/lib/shared/i18n.mjs";

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function getMessage(data, fallback) {
  return data?.message || data?.error || fallback;
}

export async function generateImage(input, { signal } = {}) {
  const response = await fetch("/api/media/image", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...creditOperationHeaders() },
    body: JSON.stringify(input),
    signal,
  });
  const data = await readJson(response);
  signal?.throwIfAborted();
  if (!response.ok) {
    throw Object.assign(new Error(getMessage(data, clientText("图片生成失败", "Image generation failed"))), { results: data.results });
  }
  if (!Array.isArray(data.results) || !data.results.length) {
    throw new Error(clientText("图片服务返回了空结果", "The image service returned an empty result"));
  }
  return data.results;
}

export async function editImage({ model, prompt, size, quality, count, images }, { signal } = {}) {
  const formData = new FormData();
  formData.append("model", model);
  formData.append("prompt", prompt);
  formData.append("size", size);
  formData.append("count", count);
  if (quality !== undefined) formData.append("quality", quality);
  images.forEach((image) => formData.append("images", image));

  const response = await fetch("/api/media/image/edit", {
    method: "POST",
    headers: creditOperationHeaders(),
    body: formData,
    signal,
  });
  const data = await readJson(response);
  signal?.throwIfAborted();
  if (!response.ok) {
    throw Object.assign(new Error(getMessage(data, clientText("图片编辑失败", "Image editing failed"))), { results: data.results });
  }
  if (!Array.isArray(data.results) || !data.results.length) {
    throw new Error(clientText("图片编辑服务返回了空结果", "The image editing service returned an empty result"));
  }
  return data.results;
}
