import crypto from "node:crypto";
import { resolveAiMediaKitConfig } from "@/lib/modelRoutes";
import {
  VIDEO_ENHANCEMENT_BITRATE_LEVELS,
  VIDEO_ENHANCEMENT_RESOLUTIONS,
  normalizeVideoEnhancementError,
} from "@/lib/media/shared/videoEnhancement";
import {
  MediaKitSecurityError,
  assertMediaKitUploadUrl,
  assertPublicHttpsMediaUrl,
  filterMediaKitUploadHeaders,
} from "@/lib/media/server/mediaKit/security";

const REQUEST_UPLOAD_PATH = "/api/v1/tools-sync/request-media-upload-url";
const ENHANCE_VIDEO_PATH = "/api/v1/tools/enhance-video-generative";
const TASKS_PATH = "/api/v1/tasks";
const REQUEST_UPLOAD_TASK_TYPE = "request-media-upload-url";
const ENHANCE_VIDEO_TASK_TYPE = "enhance-video-generative";
const MEDIAKIT_FILE_ID_PATTERN = /^mediakit:\/\/[A-Za-z0-9_-]+$/;
const MEDIAKIT_TASK_ID_PATTERN = /^[A-Za-z0-9_-]{8,256}$/;
const UPSTREAM_TASK_STATUSES = new Set(["running", "completed", "failed"]);

export class MediaKitError extends Error {
  constructor(code, { status = 502 } = {}) {
    const safe = normalizeVideoEnhancementError({ code });
    super(safe.message);
    this.name = "MediaKitError";
    this.code = safe.code;
    this.status = status;
  }
}

function mapStatusError(status) {
  if (status === 400) return new MediaKitError("INVALID_REQUEST", { status: 400 });
  if (status === 401) return new MediaKitError("UPSTREAM_AUTH_FAILED", { status: 503 });
  if (status === 403) return new MediaKitError("UPSTREAM_FORBIDDEN", { status: 503 });
  if (status === 410) return new MediaKitError("TASK_CANCELED", { status: 410 });
  if (status === 429) return new MediaKitError("UPSTREAM_RATE_LIMITED", { status: 429 });
  if (status === 500) return new MediaKitError("UPSTREAM_INTERNAL_ERROR", { status: 503 });
  if (status === 503) return new MediaKitError("UPSTREAM_UNAVAILABLE", { status: 503 });
  if (status === 504) return new MediaKitError("UPSTREAM_TIMEOUT", { status: 504 });
  return new MediaKitError("UPSTREAM_UNAVAILABLE", { status: 502 });
}

function mapPayloadError(data) {
  const marker = String(data?.error?.code || data?.error?.type || "").toLowerCase();
  if (/cancel/.test(marker)) return new MediaKitError("TASK_CANCELED", { status: 410 });
  if (/expired|gone/.test(marker)) return new MediaKitError("UPSTREAM_EXPIRED", { status: 410 });
  if (/rate|quota|thrott/.test(marker)) {
    return new MediaKitError("UPSTREAM_RATE_LIMITED", { status: 429 });
  }
  if (/auth|api.?key|unauthor/.test(marker)) {
    return new MediaKitError("UPSTREAM_AUTH_FAILED", { status: 503 });
  }
  if (/forbid|permission|access.?denied/.test(marker)) {
    return new MediaKitError("UPSTREAM_FORBIDDEN", { status: 503 });
  }
  if (/invalid|parameter|bad.?request/.test(marker)) {
    return new MediaKitError("INVALID_REQUEST", { status: 400 });
  }
  return new MediaKitError("UPSTREAM_UNAVAILABLE", { status: 502 });
}

function getConfig() {
  try {
    return resolveAiMediaKitConfig();
  } catch {
    throw new MediaKitError("SERVICE_NOT_CONFIGURED", { status: 500 });
  }
}

async function requestMediaKit(path, { method = "GET", body, signal } = {}) {
  const { apiKey, baseUrl } = getConfig();
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      redirect: "error",
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError" || error?.name === "TimeoutError") {
      throw new MediaKitError("UPSTREAM_TIMEOUT", { status: 504 });
    }
    throw new MediaKitError("UPSTREAM_NETWORK_ERROR", { status: 502 });
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) throw mapStatusError(response.status);
  if (!data || typeof data !== "object") {
    throw new MediaKitError("INVALID_UPSTREAM_RESPONSE", { status: 502 });
  }
  if (data.success !== true) throw mapPayloadError(data);
  return data;
}

function normalizeTimestamp(value) {
  if (!Number.isInteger(value) || value <= 0) return null;
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

function assertTaskId(value) {
  const taskId = typeof value === "string" ? value.trim() : "";
  if (!MEDIAKIT_TASK_ID_PATTERN.test(taskId)) {
    throw new MediaKitError("INVALID_UPSTREAM_RESPONSE", { status: 502 });
  }
  return taskId;
}

function assertClientToken(value) {
  if (typeof value !== "string" || !/^[\x20-\x7e]{1,64}$/.test(value)) {
    throw new MediaKitError("INVALID_REQUEST", { status: 400 });
  }
  return value;
}

function assertPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MediaKitError("INVALID_REQUEST", { status: 400 });
  }
}

function assertOnlyKeys(value, allowedKeys) {
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) {
    throw new MediaKitError("INVALID_REQUEST", { status: 400 });
  }
}

async function normalizeUpstreamSource(source) {
  assertPlainObject(source);
  if (source.type === "upload") {
    assertOnlyKeys(source, ["type", "providerFileId"]);
    const providerFileId = typeof source.providerFileId === "string"
      ? source.providerFileId.trim()
      : "";
    if (!MEDIAKIT_FILE_ID_PATTERN.test(providerFileId)) {
      throw new MediaKitError("INVALID_REQUEST", { status: 400 });
    }
    return providerFileId;
  }
  if (source.type === "url") {
    assertOnlyKeys(source, ["type", "url"]);
    try {
      return (await assertPublicHttpsMediaUrl(source.url)).url;
    } catch (error) {
      if (error instanceof MediaKitSecurityError) throw error;
      throw new MediaKitError("UNSAFE_MEDIA_URL", { status: 400 });
    }
  }
  throw new MediaKitError("INVALID_REQUEST", { status: 400 });
}

function normalizeSettings(input) {
  if (!VIDEO_ENHANCEMENT_RESOLUTIONS.includes(input.resolution)) {
    throw new MediaKitError("INVALID_REQUEST", { status: 400 });
  }
  const settings = { resolution: input.resolution };
  if (Object.hasOwn(input, "fps")) {
    if (!Number.isInteger(input.fps) || input.fps < 15 || input.fps > 120) {
      throw new MediaKitError("INVALID_REQUEST", { status: 400 });
    }
    settings.fps = input.fps;
  }
  assertPlainObject(input.bitrate);
  assertOnlyKeys(input.bitrate, ["mode", "value"]);
  if (input.bitrate.mode === "level") {
    if (!VIDEO_ENHANCEMENT_BITRATE_LEVELS.includes(input.bitrate.value)) {
      throw new MediaKitError("INVALID_REQUEST", { status: 400 });
    }
    settings.bitrate_level = input.bitrate.value;
  } else if (input.bitrate.mode === "exact") {
    if (
      !Number.isInteger(input.bitrate.value)
      || input.bitrate.value < 10
      || input.bitrate.value > 150000
    ) {
      throw new MediaKitError("INVALID_REQUEST", { status: 400 });
    }
    settings.bitrate = input.bitrate.value;
  } else {
    throw new MediaKitError("INVALID_REQUEST", { status: 400 });
  }
  return settings;
}

export function createMediaKitClientToken() {
  return `vve_${crypto.randomUUID().replaceAll("-", "")}`;
}

export async function requestMediaKitUploadTicket({ signal } = {}) {
  const data = await requestMediaKit(REQUEST_UPLOAD_PATH, {
    method: "POST",
    body: {},
    signal,
  });
  const result = data.result;
  const providerFileId = typeof result?.file_id === "string" ? result.file_id.trim() : "";
  const method = typeof result?.method === "string" ? result.method.trim() : "";
  if (
    data.task_type !== REQUEST_UPLOAD_TASK_TYPE
    || !MEDIAKIT_FILE_ID_PATTERN.test(providerFileId)
    || method !== "PUT"
  ) {
    throw new MediaKitError("INVALID_UPSTREAM_RESPONSE", { status: 502 });
  }
  let safeUpload;
  let uploadHeaders;
  try {
    safeUpload = await assertMediaKitUploadUrl(result.upload_url);
    uploadHeaders = filterMediaKitUploadHeaders(result.upload_headers);
  } catch {
    throw new MediaKitError("INVALID_UPSTREAM_RESPONSE", { status: 502 });
  }
  return Object.freeze({
    providerFileId,
    method,
    uploadUrl: safeUpload.url,
    uploadHeaders,
  });
}

export async function submitMediaKitVideoEnhancementTask(input, { signal } = {}) {
  assertPlainObject(input);
  assertOnlyKeys(input, ["source", "resolution", "fps", "bitrate", "clientToken"]);
  const videoUrl = await normalizeUpstreamSource(input.source);
  const settings = normalizeSettings(input);
  const body = {
    video_url: videoUrl,
    resolution: settings.resolution,
    ...(settings.fps === undefined ? {} : { fps: settings.fps }),
    ...(settings.bitrate === undefined
      ? { bitrate_level: settings.bitrate_level }
      : { bitrate: settings.bitrate }),
    client_token: assertClientToken(input.clientToken),
  };
  const data = await requestMediaKit(ENHANCE_VIDEO_PATH, { method: "POST", body, signal });
  return Object.freeze({
    taskId: assertTaskId(data.task_id),
    createdAt: normalizeTimestamp(data.created_at),
  });
}

async function normalizeTaskResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new MediaKitError("INVALID_UPSTREAM_RESPONSE", { status: 502 });
  }
  let safeUrl;
  try {
    safeUrl = await assertPublicHttpsMediaUrl(result.video_url);
  } catch {
    throw new MediaKitError("UNSAFE_MEDIA_URL", { status: 502 });
  }
  const resolution = result.resolution;
  const fps = result.fps;
  const duration = result.duration;
  if (
    !VIDEO_ENHANCEMENT_RESOLUTIONS.includes(resolution)
    || typeof fps !== "number"
    || !Number.isFinite(fps)
    || fps <= 0
    || fps > 120
    || typeof duration !== "number"
    || !Number.isFinite(duration)
    || duration < 0
  ) {
    throw new MediaKitError("INVALID_UPSTREAM_RESPONSE", { status: 502 });
  }
  return Object.freeze({
    videoUrl: safeUrl.url,
    duration,
    resolution,
    fps,
  });
}

function normalizeFailedTaskError(data) {
  const marker = String(data?.error?.code || data?.error?.type || "").toLowerCase();
  if (/cancel/.test(marker)) return normalizeVideoEnhancementError({ code: "TASK_CANCELED" });
  if (/invalid|parameter/.test(marker)) {
    return normalizeVideoEnhancementError({ code: "INVALID_REQUEST" });
  }
  return normalizeVideoEnhancementError({ code: "TASK_FAILED" });
}

export async function getMediaKitVideoEnhancementTask(taskId, { signal } = {}) {
  const normalizedTaskId = typeof taskId === "string" ? taskId.trim() : "";
  if (!MEDIAKIT_TASK_ID_PATTERN.test(normalizedTaskId)) {
    throw new MediaKitError("INVALID_REQUEST", { status: 400 });
  }
  const data = await requestMediaKit(
    `${TASKS_PATH}/${encodeURIComponent(normalizedTaskId)}`,
    { signal },
  );
  if (assertTaskId(data.task_id) !== normalizedTaskId) {
    throw new MediaKitError("INVALID_UPSTREAM_RESPONSE", { status: 502 });
  }
  const status = typeof data.status === "string" ? data.status.trim() : "";
  const hasTaskType = Object.hasOwn(data, "task_type");
  if (
    (hasTaskType && data.task_type !== ENHANCE_VIDEO_TASK_TYPE)
    || !UPSTREAM_TASK_STATUSES.has(status)
  ) {
    throw new MediaKitError("INVALID_UPSTREAM_RESPONSE", { status: 502 });
  }
  return Object.freeze({
    taskId: normalizedTaskId,
    status,
    result: status === "completed" ? await normalizeTaskResult(data.result) : null,
    error: status === "failed" ? normalizeFailedTaskError(data) : null,
    createdAt: normalizeTimestamp(data.created_at),
    finishedAt: normalizeTimestamp(data.finished_at),
    expiresAt: normalizeTimestamp(data.expires_at),
  });
}
