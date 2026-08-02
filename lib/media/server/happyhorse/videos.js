import { resolveHappyHorseVideoConfig } from "@/lib/modelRoutes";
import { VIDEO_MODELS } from "@/lib/media/shared/models";

export const VIDEO_ACTIVE_STATUSES = new Set(["queued", "in_progress"]);

const STATUS_MAP = Object.freeze({
  PENDING: "queued",
  RUNNING: "in_progress",
  SUCCEEDED: "completed",
  FAILED: "failed",
  CANCELED: "canceled",
  UNKNOWN: "failed",
});

function getHeaders({ create = false } = {}) {
  const { apiKey } = resolveHappyHorseVideoConfig();
  return {
    Authorization: `Bearer ${apiKey}`,
    ...(create
      ? {
          "Content-Type": "application/json",
          "X-DashScope-Async": "enable",
        }
      : {}),
  };
}

async function readJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.code) {
    const code = String(data?.code || data?.output?.code || "").trim();
    const normalizedCode = code.toLowerCase();
    const upstreamMessage = String(data?.message || data?.output?.message || "").trim();
    let message = upstreamMessage || `HappyHorse 视频服务请求失败（${response.status}）`;
    if (normalizedCode.includes("invalidapikey") || response.status === 401) {
      message = "HappyHorse 视频服务的 API 密钥无效";
    } else if (
      normalizedCode.includes("accessdenied")
      || normalizedCode.includes("permission")
      || response.status === 403
    ) {
      message = "尚未开通 HappyHorse 视频模型权限";
    } else if (response.status === 429) {
      message = "HappyHorse 视频服务请求过于频繁，请稍后再试";
    }
    const error = new Error(message);
    error.status = response.status >= 400 && response.status <= 599 ? response.status : 502;
    error.upstreamStatus = response.status;
    error.code = code;
    error.payload = data;
    throw error;
  }
  return data;
}

function buildInput(mode, prompt, sourceUrls) {
  const input = prompt ? { prompt } : {};
  if (mode === "first-frame") {
    input.media = [{ type: "first_frame", url: sourceUrls.images[0] }];
  } else if (mode === "reference") {
    input.media = sourceUrls.images.map((url) => ({ type: "reference_image", url }));
  } else if (mode === "edit") {
    input.media = [
      { type: "video", url: sourceUrls.video },
      ...sourceUrls.images.map((url) => ({ type: "reference_image", url })),
    ];
  }
  return input;
}

function buildParameters(mode, params) {
  const parameters = {
    resolution: params.resolution,
    watermark: Boolean(params.watermark),
  };
  if (mode !== "edit") parameters.duration = params.duration;
  if (mode === "text" || mode === "reference") parameters.ratio = params.ratio;
  if (mode === "edit") parameters.audio_setting = params.audioSetting;
  if (Number.isInteger(params.seed)) parameters.seed = params.seed;
  return parameters;
}

export async function createHappyHorseVideoTask({
  mode,
  prompt,
  params,
  sourceUrls,
  signal,
}) {
  const { createEndpoint } = resolveHappyHorseVideoConfig();
  const response = await fetch(createEndpoint, {
    method: "POST",
    headers: getHeaders({ create: true }),
    body: JSON.stringify({
      model: VIDEO_MODELS[mode],
      input: buildInput(mode, prompt, sourceUrls),
      parameters: buildParameters(mode, params),
    }),
    signal,
  });
  return readJson(response);
}

export async function getHappyHorseVideoTask(taskId, { signal } = {}) {
  const { tasksEndpoint } = resolveHappyHorseVideoConfig();
  const response = await fetch(`${tasksEndpoint}/${encodeURIComponent(taskId)}`, {
    headers: getHeaders(),
    signal,
  });
  return readJson(response);
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function buildHappyHorseTaskPatch(upstreamTask) {
  const output = upstreamTask?.output && typeof upstreamTask.output === "object"
    ? upstreamTask.output
    : {};
  const upstreamStatus = String(output.task_status || "UNKNOWN").toUpperCase();
  const status = STATUS_MAP[upstreamStatus] || "failed";
  let error = null;
  if (upstreamStatus === "FAILED") {
    const code = String(output.code || "VIDEO_GENERATION_FAILED");
    error = {
      code,
      message: code.toLowerCase().includes("invalidparameter")
        ? "视频参数不符合 HappyHorse 模型要求"
        : "HappyHorse 未能完成本次视频任务",
    };
  } else if (upstreamStatus === "CANCELED") {
    error = {
      code: "VIDEO_GENERATION_CANCELED",
      message: "视频任务已取消",
    };
  } else if (upstreamStatus === "UNKNOWN" || !STATUS_MAP[upstreamStatus]) {
    error = {
      code: "VIDEO_TASK_UNKNOWN",
      message: "视频任务不存在或已超过 24 小时有效期",
    };
  }

  return {
    status,
    upstreamStatus,
    error,
    usage: upstreamTask?.usage || null,
    upstreamResponse: upstreamTask || null,
    outputUrl: typeof output.video_url === "string" ? output.video_url.trim() : "",
    upstreamCreatedAt: parseDate(output.submit_time),
    upstreamUpdatedAt: parseDate(output.end_time || output.scheduled_time) || new Date(),
  };
}
