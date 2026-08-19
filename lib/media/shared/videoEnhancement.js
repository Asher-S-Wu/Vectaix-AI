export const VIDEO_ENHANCEMENT_MODEL = "ai-mediakit-video-enhancement";
export const VIDEO_ENHANCEMENT_MODEL_NAME = "AI MediaKit 视频画质增强";

export const VIDEO_ENHANCEMENT_UPLOAD_MAX_BYTES = 5 * 1024 * 1024 * 1024;
export const VIDEO_ENHANCEMENT_RESULT_MAX_BYTES = 10 * 1024 * 1024 * 1024;
export const VIDEO_ENHANCEMENT_UPLOAD_TICKET_TTL_MS = 24 * 60 * 60 * 1000;

export const VIDEO_ENHANCEMENT_INPUT_MIME_TYPES_BY_EXTENSION = Object.freeze({
  mp4: Object.freeze(["video/mp4"]),
  flv: Object.freeze(["video/x-flv", "video/flv"]),
  ts: Object.freeze(["video/mp2t"]),
  avi: Object.freeze(["video/x-msvideo", "video/avi"]),
  mov: Object.freeze(["video/quicktime"]),
  wmv: Object.freeze(["video/x-ms-wmv", "video/wmv"]),
  mkv: Object.freeze(["video/x-matroska", "video/mkv"]),
});
export const VIDEO_ENHANCEMENT_INPUT_EXTENSIONS = Object.freeze(
  Object.keys(VIDEO_ENHANCEMENT_INPUT_MIME_TYPES_BY_EXTENSION),
);
export const VIDEO_ENHANCEMENT_INPUT_MIME_TYPES = Object.freeze(
  [...new Set(Object.values(VIDEO_ENHANCEMENT_INPUT_MIME_TYPES_BY_EXTENSION).flat())],
);
export const VIDEO_ENHANCEMENT_OUTPUT_EXTENSIONS = Object.freeze(["mp4"]);
export const VIDEO_ENHANCEMENT_OUTPUT_MIME_TYPES = Object.freeze(["video/mp4"]);

export const VIDEO_ENHANCEMENT_SOURCE_TYPES = Object.freeze(["upload", "url"]);
export const VIDEO_ENHANCEMENT_RESOLUTIONS = Object.freeze(["720p", "1080p", "2k"]);
export const VIDEO_ENHANCEMENT_BITRATE_LEVELS = Object.freeze(["low", "medium", "high"]);
export const VIDEO_ENHANCEMENT_BITRATE_MODES = Object.freeze(["level", "exact"]);
export const VIDEO_ENHANCEMENT_TASK_STATUSES = Object.freeze([
  "submitting",
  "running",
  "finalizing",
  "completed",
  "failed",
  "canceled",
]);

export const VIDEO_ENHANCEMENT_ERROR_MESSAGES = Object.freeze({
  INVALID_REQUEST: "视频画质增强参数不符合要求",
  UPSTREAM_AUTH_FAILED: "视频画质增强服务密钥无效",
  UPSTREAM_FORBIDDEN: "当前账号无权使用视频画质增强服务",
  UPSTREAM_EXPIRED: "视频画质增强任务或上传凭证已过期",
  UPSTREAM_RATE_LIMITED: "视频画质增强请求过于频繁，请稍后再试",
  UPSTREAM_INTERNAL_ERROR: "视频画质增强服务暂时不可用",
  UPSTREAM_UNAVAILABLE: "视频画质增强服务暂时不可用",
  UPSTREAM_TIMEOUT: "视频画质增强服务响应超时",
  UPSTREAM_NETWORK_ERROR: "无法连接视频画质增强服务",
  INVALID_UPSTREAM_RESPONSE: "视频画质增强服务返回了无法识别的数据",
  UNSAFE_MEDIA_URL: "视频地址未通过安全检查",
  RESULT_TOO_LARGE: "视频画质增强结果超过大小限制",
  RESULT_DOWNLOAD_FAILED: "下载视频画质增强结果失败",
  RESULT_SAVE_FAILED: "保存视频画质增强结果失败",
  SERVICE_NOT_CONFIGURED: "视频画质增强服务尚未配置",
  TASK_FAILED: "视频画质增强任务未能完成",
  TASK_CANCELED: "视频画质增强任务已取消",
});
export const VIDEO_ENHANCEMENT_ERROR_CODES = Object.freeze(
  Object.keys(VIDEO_ENHANCEMENT_ERROR_MESSAGES),
);

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label}必须是对象`);
  }
}

function assertOnlyKeys(value, allowedKeys, label) {
  const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unknownKeys.length) throw new TypeError(`${label}包含不支持的参数`);
}

function normalizeInteger(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${label}必须是 ${min} 到 ${max} 之间的整数`);
  }
  return value;
}

function normalizeSource(value) {
  assertPlainObject(value, "视频来源");
  if (value.type === "upload") {
    assertOnlyKeys(value, ["type", "uploadTicketId"], "视频来源");
    const uploadTicketId = typeof value.uploadTicketId === "string"
      ? value.uploadTicketId.trim()
      : "";
    if (!/^[a-f\d]{24}$/i.test(uploadTicketId)) {
      throw new TypeError("上传凭证格式不正确");
    }
    return Object.freeze({ type: "upload", uploadTicketId });
  }
  if (value.type !== "url") {
    throw new TypeError("视频来源必须且只能选择本地上传或公网地址中的一种");
  }
  assertOnlyKeys(value, ["type", "url"], "视频来源");
  const url = typeof value.url === "string" ? value.url.trim() : "";
  if (!url || url.length > 8192) throw new TypeError("视频地址不符合要求");
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new TypeError("公网视频地址格式不正确");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || (parsed.port && parsed.port !== "443")
    || parsed.hash
  ) {
    throw new TypeError("公网视频地址必须是安全的 HTTPS 地址");
  }
  return Object.freeze({ type: "url", url: parsed.toString() });
}

function normalizeBitrate(value) {
  assertPlainObject(value, "视频码率");
  assertOnlyKeys(value, ["mode", "value"], "视频码率");
  if (value.mode === "level") {
    if (!VIDEO_ENHANCEMENT_BITRATE_LEVELS.includes(value.value)) {
      throw new TypeError("不支持的视频码率档位");
    }
    return Object.freeze({ mode: "level", value: value.value });
  }
  if (value.mode !== "exact") throw new TypeError("不支持的视频码率方式");
  return Object.freeze({
    mode: "exact",
    value: normalizeInteger(value.value, "精确码率", 10, 150000),
  });
}

export function normalizeVideoEnhancementCreateInput(value) {
  assertPlainObject(value, "视频画质增强参数");
  assertOnlyKeys(value, ["source", "resolution", "fps", "bitrate"], "视频画质增强参数");
  if (!VIDEO_ENHANCEMENT_RESOLUTIONS.includes(value.resolution)) {
    throw new TypeError("不支持的目标分辨率");
  }
  const normalized = {
    source: normalizeSource(value.source),
    resolution: value.resolution,
    bitrate: normalizeBitrate(value.bitrate),
  };
  if (Object.hasOwn(value, "fps")) {
    normalized.fps = normalizeInteger(value.fps, "目标帧率", 15, 120);
  }
  return Object.freeze(normalized);
}

function getExtension(originalName) {
  const match = /\.([a-z\d]+)$/i.exec(originalName);
  return match ? match[1].toLowerCase() : "";
}

function normalizeSafeOriginalName(value) {
  if (typeof value !== "string") throw new TypeError("视频文件名必须是文本");
  const filename = value
    .replaceAll("\\", "/")
    .split("/")
    .pop()
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"|?*#]/g, "_")
    .trim();
  if (!filename || filename === "." || filename === ".." || filename.length > 180) {
    throw new TypeError("视频文件名不符合要求");
  }
  return filename;
}

export function normalizeVideoEnhancementUploadInput(value) {
  assertPlainObject(value, "视频上传参数");
  assertOnlyKeys(value, ["originalName", "size", "mimeType"], "视频上传参数");
  const safeOriginalName = normalizeSafeOriginalName(value.originalName);
  const extension = getExtension(safeOriginalName);
  const mimeType = typeof value.mimeType === "string"
    ? value.mimeType.toLowerCase().split(";")[0].trim()
    : "";
  if (!VIDEO_ENHANCEMENT_INPUT_EXTENSIONS.includes(extension)) {
    throw new TypeError("仅支持 MP4、FLV、TS、AVI、MOV、WMV、MKV 视频文件");
  }
  if (!VIDEO_ENHANCEMENT_INPUT_MIME_TYPES_BY_EXTENSION[extension].includes(mimeType)) {
    throw new TypeError("视频文件扩展名与文件类型不匹配，仅支持 MP4、FLV、TS、AVI、MOV、WMV、MKV");
  }
  return Object.freeze({
    safeOriginalName,
    size: normalizeInteger(
      value.size,
      "视频文件大小",
      1,
      VIDEO_ENHANCEMENT_UPLOAD_MAX_BYTES,
    ),
    mimeType,
    extension,
  });
}

export function createVideoEnhancementUploadExpiry(now = new Date()) {
  const timestamp = now instanceof Date ? now.getTime() : Number.NaN;
  if (!Number.isFinite(timestamp)) throw new TypeError("上传凭证签发时间无效");
  return new Date(timestamp + VIDEO_ENHANCEMENT_UPLOAD_TICKET_TTL_MS);
}

export function normalizeVideoEnhancementError(value) {
  const code = VIDEO_ENHANCEMENT_ERROR_CODES.includes(value?.code)
    ? value.code
    : "TASK_FAILED";
  return Object.freeze({ code, message: VIDEO_ENHANCEMENT_ERROR_MESSAGES[code] });
}
