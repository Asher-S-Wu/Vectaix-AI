import { resolveInfereraMediaConfig } from "@/lib/modelRoutes";
import { saveVideoBuffer } from "@/lib/media/storage";
import { VIDEO_MODEL } from "@/lib/media/shared/models";

export const VIDEO_ACTIVE_STATUSES = new Set(["queued", "in_progress"]);

function getConfig() {
  return resolveInfereraMediaConfig();
}

function getHeaders({ json = true } = {}) {
  const { apiKey } = getConfig();
  return {
    Authorization: `Bearer ${apiKey}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

function taskUrl(taskId, suffix = "") {
  return `${getConfig().baseUrl}/videos/${encodeURIComponent(taskId)}${suffix}`;
}

async function readJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || data?.message || `视频服务请求失败（${response.status}）`);
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

export async function fileToDataUrl(file) {
  const bytes = Buffer.from(await file.arrayBuffer()).toString("base64");
  return `data:${file.type || "image/png"};base64,${bytes}`;
}

export async function createUpstreamVideoTask({
  prompt,
  image,
  ratio,
  duration,
  resolution,
  generateAudio,
  watermark,
  signal,
}) {
  const extraBody = {
    ratio,
    duration,
    resolution,
    generate_audio: Boolean(generateAudio),
    watermark: Boolean(watermark),
  };
  if (image) {
    extraBody.content = [{
      type: "image_url",
      role: "reference_image",
      image_url: { url: await fileToDataUrl(image) },
    }];
  }
  const response = await fetch(`${getConfig().baseUrl}/videos`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ model: VIDEO_MODEL, prompt, extra_body: extraBody }),
    signal,
  });
  return readJson(response);
}

export async function getUpstreamVideoTask(taskId, { signal } = {}) {
  const response = await fetch(taskUrl(taskId), { headers: getHeaders({ json: false }), signal });
  return readJson(response);
}

export async function deleteUpstreamVideoTask(taskId, { signal } = {}) {
  const response = await fetch(taskUrl(taskId), { method: "DELETE", headers: getHeaders({ json: false }), signal });
  if (response.ok) return;
  await readJson(response);
}

export async function storeUpstreamVideoOutput(taskId, { userId, ownerId, signal } = {}) {
  const response = await fetch(taskUrl(taskId, "/content"), {
    headers: getHeaders({ json: false }),
    signal,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(data?.error?.message || data?.message || `下载视频失败（${response.status}）`);
    error.status = response.status;
    throw error;
  }
  const contentType = response.headers.get("content-type") || "video/mp4";
  return saveVideoBuffer({ userId, ownerId, input: await response.arrayBuffer(), mimeType: contentType });
}

function parseDate(value) {
  if (!value) return null;
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function buildUpstreamTaskPatch(upstreamTask) {
  return {
    status: typeof upstreamTask?.status === "string" ? upstreamTask.status : "queued",
    error: upstreamTask?.error || null,
    usage: upstreamTask?.usage || null,
    upstreamResponse: upstreamTask || null,
    upstreamCreatedAt: parseDate(upstreamTask?.created_at || upstreamTask?.createdAt),
    upstreamUpdatedAt: parseDate(upstreamTask?.updated_at || upstreamTask?.updatedAt),
  };
}
