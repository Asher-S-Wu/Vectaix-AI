import undici from "undici";
import { resolveMicuImageConfig } from "@/lib/modelRoutes";
import { saveImageBuffer } from "@/lib/media/storage";
import { inspectUploadedFile } from "@/lib/server/storage/fileInspection";

const REQUEST_TIMEOUT_MS = 600_000;

class MicuImageAgent extends undici.Agent {
  dispatch(options, handler) {
    // Fetch supplies its own request timeout; keep both phases
    // within the same ten-minute allowance as the overall abort timer.
    return super.dispatch({
      ...options,
      headersTimeout: REQUEST_TIMEOUT_MS,
      bodyTimeout: REQUEST_TIMEOUT_MS,
    }, handler);
  }
}

const micuImageAgent = new MicuImageAgent({
  headersTimeout: REQUEST_TIMEOUT_MS,
  bodyTimeout: REQUEST_TIMEOUT_MS,
  connectTimeout: REQUEST_TIMEOUT_MS,
});

function createServiceError(message, status = 502, details = {}) {
  return Object.assign(new Error(message), {
    status,
    code: "UPSTREAM_ERROR",
    requestId: undefined,
    upstreamRejected: false,
    ...details,
  });
}

function createAbortError(reason) {
  return createServiceError("图片请求已取消", 499, {
    name: "AbortError",
    code: "REQUEST_CANCELLED",
    cause: reason,
  });
}

function readRequestId(data, response) {
  const bodyId = typeof data?.request_id === "string" ? data.request_id.trim() : "";
  return bodyId || response.headers.get("x-request-id")?.trim() || undefined;
}

function sanitizeErrorDetail(value, apiKey) {
  if (typeof value !== "string") return "";
  return value
    .replaceAll(apiKey, "[已隐藏]")
    .replace(/\bBearer\s+[^\s;,"')\]]+/gi, "Bearer [已隐藏]")
    .replace(/\bsk-[\w-]+/g, "[已隐藏]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 800);
}

function createResponseError(response, data, apiKey) {
  const upstreamCode = data?.error?.code ?? data?.code;
  let code = sanitizeErrorDetail(upstreamCode, apiKey) || "UPSTREAM_ERROR";
  const upstreamMessage = sanitizeErrorDetail(
    typeof data === "string" ? data : data?.error?.message ?? data?.message,
    apiKey,
  );
  const upstreamType = sanitizeErrorDetail(data?.error?.type, apiKey);
  const upstreamParam = sanitizeErrorDetail(data?.error?.param, apiKey);
  let status = response.status >= 400 ? response.status : 502;
  // Micu can wrap a rate-limit rejection in HTTP 400.
  if (status === 400 && /too many requests|rate[ _-]?limit/i.test(`${code} ${upstreamType} ${upstreamMessage}`)) {
    status = 429;
    code = "UPSTREAM_RATE_LIMITED";
  }
  const normalizedCode = code.toLowerCase();
  let message;
  if (status === 401 || normalizedCode.includes("invalid_api_key")) {
    message = "Micu 图片服务的 API 密钥无效";
  } else if (
    status === 403
    || normalizedCode.includes("permission")
    || normalizedCode.includes("access_denied")
  ) {
    message = "Micu 图片服务尚未开通所选模型权限";
  } else if (status === 429) {
    message = "Micu 图片服务请求过于频繁，请稍后再试";
  } else if (status === 400 || status === 422) {
    message = `Micu 图片服务拒绝了本次请求（${status}）`;
  } else {
    message = `Micu 图片服务请求失败（${status}）`;
  }
  if (upstreamMessage) message += `：${upstreamMessage}`;
  return createServiceError(message, status, {
    code,
    requestId: sanitizeErrorDetail(readRequestId(data, response), apiKey) || undefined,
    upstreamStatus: response.status,
    upstreamMessage,
    upstreamType,
    upstreamParam,
    upstreamRejected: response.status >= 400 && response.status < 500,
  });
}

function invalidResponse(message, requestId) {
  return createServiceError(message, 502, { code: "INVALID_UPSTREAM_RESPONSE", requestId });
}

function decodeImage(data, requestId) {
  const encoded = data?.data?.[0]?.b64_json;
  if (typeof encoded !== "string" || !encoded) {
    throw invalidResponse("Micu 图片服务没有返回图片结果", requestId);
  }
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw invalidResponse("Micu 图片服务返回的图片编码无效", requestId);
  }
  const input = Buffer.from(encoded, "base64");
  if (input.toString("base64") !== encoded) {
    throw invalidResponse("Micu 图片服务返回的图片编码无效", requestId);
  }
  for (const extension of ["png", "jpg", "webp"]) {
    const inspected = inspectUploadedFile(input, extension);
    if (inspected) return { input, mimeType: inspected.mimeType };
  }
  throw invalidResponse("Micu 图片服务返回的内容不是有效的 PNG、JPEG 或 WebP 图片", requestId);
}

export async function requestMicuImage({
  model,
  prompt,
  size,
  quality,
  images = [],
  signal,
  onRequestDispatched,
}) {
  const { apiKey, endpoint, editEndpoint } = resolveMicuImageConfig();
  if (signal?.aborted) throw createAbortError(signal.reason);

  const controller = new AbortController();
  const cancel = () => controller.abort(createAbortError(signal.reason));
  signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(() => controller.abort(createServiceError(
    "Micu 图片服务请求超时，请稍后再试",
    504,
    { code: "UPSTREAM_TIMEOUT" },
  )), REQUEST_TIMEOUT_MS);

  let requestId;
  try {
    const headers = { Authorization: `Bearer ${apiKey}` };
    let body;
    if (images.length) {
      body = new undici.FormData();
      for (const [key, value] of Object.entries({ model, prompt, size, quality, n: 1, response_format: "b64_json" })) {
        body.set(key, value);
      }
      const field = images.length === 1 ? "image" : "image[]";
      for (const image of images) body.append(field, image, image.name);
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify({ model, prompt, size, quality, n: 1, response_format: "b64_json" });
    }

    const pending = undici.fetch(images.length ? editEndpoint : endpoint, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
      dispatcher: micuImageAgent,
      redirect: "error",
    });
    onRequestDispatched?.();
    const response = await pending;
    requestId = readRequestId(undefined, response);
    if (!response.ok) {
      const responseText = await response.text();
      let errorData;
      try {
        errorData = JSON.parse(responseText);
      } catch {
        errorData = responseText;
      }
      throw createResponseError(response, errorData, apiKey);
    }
    let data;
    try {
      data = await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (!(error instanceof SyntaxError)) throw error;
      throw invalidResponse("Micu 图片服务返回了无法识别的结果", requestId);
    }
    requestId = readRequestId(data, response);
    if (data?.error || data?.code) throw createResponseError(response, data, apiKey);
    return { ...decodeImage(data, requestId), requestId, usage: data?.usage };
  } catch (error) {
    if (controller.signal.aborted) {
      controller.signal.reason.requestId = requestId;
      throw controller.signal.reason;
    }
    if (error?.upstreamStatus) {
      console.error("[Micu Image] request failed:", {
        status: error.status,
        upstreamStatus: error.upstreamStatus,
        code: error.code,
        type: error.upstreamType,
        param: error.upstreamParam,
        message: error.upstreamMessage,
        requestId: error.requestId,
        model,
        size,
        quality,
        inputImageCount: images.length,
      });
    }
    if (error?.status) throw error;
    throw createServiceError("暂时无法连接 Micu 图片服务", 502, {
      code: "UPSTREAM_NETWORK_ERROR", requestId, cause: error,
    });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
}

export async function generateAndStoreMicuImageFile({
  userId,
  model,
  prompt,
  size,
  quality,
  images = [],
  ownerType,
  ownerId,
  signal,
  mediaWriteLease,
  onRequestDispatched,
  onUpstreamComplete,
}) {
  const { input, mimeType, requestId, usage } = await requestMicuImage({
    model, prompt, size, quality, images, signal, onRequestDispatched,
  });
  await onUpstreamComplete?.({ requestId, usage });
  return saveImageBuffer({ userId, input, mimeType, ownerType, ownerId, mediaWriteLease });
}
