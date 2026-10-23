import { creditOperationHeaders } from "@/lib/client/credits/operations";

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
    throw Object.assign(new Error(getMessage(data, "图片生成失败")), { results: data.results });
  }
  if (!Array.isArray(data.results) || !data.results.length) {
    throw new Error("图片生成完成，但没有返回结果");
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
    throw Object.assign(new Error(getMessage(data, "图片编辑失败")), { results: data.results });
  }
  if (!Array.isArray(data.results) || !data.results.length) {
    throw new Error("图片编辑完成，但没有返回结果");
  }
  return data.results;
}
