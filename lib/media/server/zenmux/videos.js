import { resolveZenMuxProviderConfig } from "@/lib/modelRoutes";
import {
  VIDEO_MODEL,
  parseModelSlug,
} from "@/lib/media/shared/models";
import { saveMediaFromUrl, saveVideoBuffer } from "@/lib/media/storage";

const ZENMUX_VERTEX_BASE_URL = "https://zenmux.ai/api/vertex-ai/v1";
const POLL_INTERVAL_MS = 15_000;
const MAX_POLL_ATTEMPTS = 40;

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("请求已取消"));
    }, { once: true });
  });
}

function getAuthHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

async function readJsonResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data?.error?.message === "string"
      ? data.error.message
      : (typeof data?.message === "string" ? data.message : `视频服务请求失败（${response.status}）`);
    throw new Error(message);
  }
  return data;
}

function extractVideoPayload(response) {
  const videos = Array.isArray(response?.videos) ? response.videos : [];
  const first = videos[0];
  if (!first || typeof first !== "object") {
    throw new Error("视频生成失败，未返回有效结果");
  }

  const gcsUri = typeof first.gcsUri === "string" ? first.gcsUri : "";
  const bytesBase64Encoded = typeof first.bytesBase64Encoded === "string" ? first.bytesBase64Encoded : "";
  const mimeType = typeof first.mimeType === "string" ? first.mimeType : "video/mp4";

  return { gcsUri, bytesBase64Encoded, mimeType };
}

function normalizeOptionalText(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

function normalizeOptionalNumber(value) {
  return Number.isFinite(value) ? value : undefined;
}

async function fileToVertexImage(file) {
  if (!file) return undefined;
  const bytes = Buffer.from(await file.arrayBuffer()).toString("base64");
  return {
    bytesBase64Encoded: bytes,
    mimeType: file.type || "image/png",
  };
}

export async function generateAndStoreVideo({
  prompt,
  image,
  lastFrame,
  aspectRatio = "16:9",
  durationSeconds = 5,
  resolution = "720p",
  generateAudio = true,
  negativePrompt,
  enhancePrompt,
  personGeneration,
  seed,
  fps,
  sampleCount = 1,
  signal,
}) {
  const { apiKey } = resolveZenMuxProviderConfig();
  const { provider, model } = parseModelSlug(VIDEO_MODEL);
  const submitUrl = `${ZENMUX_VERTEX_BASE_URL}/publishers/${provider}/models/${model}:predictLongRunning`;
  const pollUrl = `${ZENMUX_VERTEX_BASE_URL}/publishers/${provider}/models/${model}:fetchPredictOperation`;
  const instance = {
    prompt,
  };
  const vertexImage = await fileToVertexImage(image);
  const vertexLastFrame = await fileToVertexImage(lastFrame);

  if (vertexImage) {
    instance.image = vertexImage;
  }
  if (vertexLastFrame) {
    instance.lastFrame = vertexLastFrame;
  }

  const parameters = {
    aspectRatio,
    durationSeconds,
    resolution,
    generateAudio,
    sampleCount,
  };
  const normalizedNegativePrompt = normalizeOptionalText(negativePrompt);
  const normalizedPersonGeneration = normalizeOptionalText(personGeneration);
  const normalizedSeed = normalizeOptionalNumber(seed);
  const normalizedFps = normalizeOptionalNumber(fps);

  if (normalizedNegativePrompt) {
    parameters.negativePrompt = normalizedNegativePrompt;
  }
  if (typeof enhancePrompt === "boolean") {
    parameters.enhancePrompt = enhancePrompt;
  }
  if (normalizedPersonGeneration) {
    parameters.personGeneration = normalizedPersonGeneration;
  }
  if (normalizedSeed !== undefined) {
    parameters.seed = normalizedSeed;
  }
  if (normalizedFps !== undefined) {
    parameters.fps = normalizedFps;
  }

  const submitResponse = await fetch(submitUrl, {
    method: "POST",
    headers: getAuthHeaders(apiKey),
    body: JSON.stringify({
      instances: [instance],
      parameters,
    }),
    signal,
  });

  const submitData = await readJsonResponse(submitResponse);
  const operationName = typeof submitData?.name === "string" ? submitData.name : "";
  if (!operationName) {
    throw new Error("视频生成任务提交失败");
  }

  let latestOperation = submitData;

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    if (latestOperation.done === true) {
      break;
    }

    await sleep(POLL_INTERVAL_MS, signal);

    const pollResponse = await fetch(pollUrl, {
      method: "POST",
      headers: getAuthHeaders(apiKey),
      body: JSON.stringify({ operationName }),
      signal,
    });

    latestOperation = await readJsonResponse(pollResponse);
  }

  if (latestOperation.done !== true) {
    throw new Error("视频生成超时，请稍后再试");
  }

  if (latestOperation.error) {
    const message = typeof latestOperation.error === "object" &&
      latestOperation.error &&
      typeof latestOperation.error.message === "string"
      ? latestOperation.error.message
      : "视频生成失败";
    throw new Error(message);
  }

  const raiMediaFilteredCount = Number(latestOperation.response?.raiMediaFilteredCount);
  if (Number.isFinite(raiMediaFilteredCount) && raiMediaFilteredCount > 0) {
    const reasons = latestOperation.response?.raiMediaFilteredReasons;
    const reasonText = Array.isArray(reasons) ? reasons.map((item) => String(item)).filter(Boolean).join("；") : "";
    throw new Error(reasonText || "视频内容未通过安全审核");
  }

  const response = latestOperation.response;
  if (!response || typeof response !== "object") {
    throw new Error("视频生成失败，未返回有效结果");
  }

  const { gcsUri, bytesBase64Encoded, mimeType } = extractVideoPayload(response);

  if (bytesBase64Encoded) {
    const saved = await saveVideoBuffer(Buffer.from(bytesBase64Encoded, "base64"), mimeType);
    return saved.url;
  }

  if (gcsUri) {
    const saved = await saveMediaFromUrl(gcsUri, mimeType, "media-video");
    return saved.url;
  }

  throw new Error("视频生成失败，未返回可下载内容");
}
