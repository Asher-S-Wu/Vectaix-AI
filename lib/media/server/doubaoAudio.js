import { resolveDoubaoAudioConfig } from "@/lib/modelRoutes";
import {
  DOUBAO_AUDIO_MODEL,
  DOUBAO_AUDIO_OUTPUT_MAX_DURATION_SECONDS,
  getDoubaoAudioFormat,
} from "@/lib/media/shared/doubaoAudio";
import { inspectAudioMetadata } from "@/lib/media/server/audioSampleInspection";

const MAX_SUBTITLE_SENTENCES = 5000;

export class DoubaoAudioError extends Error {
  constructor(message, {
    status = 502,
    code = "DOUBAO_AUDIO_ERROR",
    requestId = "",
    logId = "",
    upstreamMessage = "",
  } = {}) {
    super(message);
    this.name = "DoubaoAudioError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.logId = logId;
    this.upstreamMessage = upstreamMessage;
  }
}

function mapUpstreamError(response, data, requestId, logId) {
  const upstreamCode = String(data?.code ?? "").trim();
  const upstreamMessage = String(data?.message || "").trim();
  const source = `${upstreamCode} ${upstreamMessage}`.toLowerCase();

  if (response.status === 401 || /api.?key|unauthor|authentication/.test(source)) {
    return new DoubaoAudioError("Doubao 音频服务密钥无效", {
      status: 503,
      code: upstreamCode || "INVALID_API_KEY",
      requestId,
      logId,
      upstreamMessage,
    });
  }
  if (response.status === 403 || /permission|forbidden|access.?denied|not.?authorized/.test(source)) {
    return new DoubaoAudioError("当前火山引擎账号无权使用 Doubao 音频生成服务", {
      status: 403,
      code: upstreamCode || "PERMISSION_DENIED",
      requestId,
      logId,
      upstreamMessage,
    });
  }
  if (response.status === 429 || /quota|rate.?limit|too many|throttl/.test(source)) {
    return new DoubaoAudioError("Doubao 音频生成请求过于频繁或额度不足，请稍后再试", {
      status: 429,
      code: upstreamCode || "RATE_LIMITED",
      requestId,
      logId,
      upstreamMessage,
    });
  }
  if (response.status === 400 || /invalid|parameter|bad.?request/.test(source)) {
    return new DoubaoAudioError("Doubao 音频生成参数不符合要求", {
      status: 400,
      code: upstreamCode || "INVALID_PARAMETER",
      requestId,
      logId,
      upstreamMessage,
    });
  }
  return new DoubaoAudioError("Doubao 音频生成服务暂时不可用", {
    status: response.status >= 500
      ? 502
      : response.status >= 400
        ? response.status
        : 502,
    code: upstreamCode || "UPSTREAM_ERROR",
    requestId,
    logId,
    upstreamMessage,
  });
}

function decodeAudioBase64(value, requestId, logId) {
  const encoded = typeof value === "string" ? value.trim() : "";
  if (
    !encoded
    || encoded.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
  ) {
    throw new DoubaoAudioError("Doubao 音频服务返回了无效的音频数据", {
      code: "INVALID_AUDIO_DATA",
      requestId,
      logId,
    });
  }
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length || buffer.toString("base64") !== encoded) {
    throw new DoubaoAudioError("Doubao 音频服务返回了无效的音频数据", {
      code: "INVALID_AUDIO_DATA",
      requestId,
      logId,
    });
  }
  return buffer;
}

function normalizeDuration(value, label, requestId, logId) {
  const duration = Number(value);
  if (
    !Number.isFinite(duration)
    || duration <= 0
    || duration > DOUBAO_AUDIO_OUTPUT_MAX_DURATION_SECONDS
  ) {
    throw new DoubaoAudioError(`Doubao 音频服务返回了无效的${label}`, {
      code: "INVALID_DURATION",
      requestId,
      logId,
    });
  }
  return Math.round(duration * 1000) / 1000;
}

function normalizeTime(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function normalizeSubtitleItem(item) {
  if (!item || typeof item !== "object") return null;
  const startTime = normalizeTime(item.start_time);
  const endTime = normalizeTime(item.end_time);
  const text = typeof item.text === "string" ? item.text : "";
  if (startTime === null || endTime === null || endTime < startTime || !text) return null;
  return { startTime, endTime, text };
}

function normalizeSubtitle(value) {
  if (!value || typeof value !== "object") return null;
  const text = typeof value.text === "string" ? value.text : "";
  const sourceSentences = Array.isArray(value.sentences) ? value.sentences : [];
  if (sourceSentences.length > MAX_SUBTITLE_SENTENCES) return null;
  const sentences = [];
  for (const sourceSentence of sourceSentences) {
    const sentence = normalizeSubtitleItem(sourceSentence);
    if (!sentence) continue;
    sentences.push(sentence);
  }
  if (!text && sentences.length === 0) return null;
  return { text, sentences };
}

export async function generateDoubaoAudio(input, { signal } = {}) {
  let config;
  try {
    config = resolveDoubaoAudioConfig();
  } catch (error) {
    throw new DoubaoAudioError("Doubao 音频服务密钥尚未配置", {
      status: 500,
      code: "MISSING_API_KEY",
      requestId: input.requestId,
      upstreamMessage: error instanceof Error ? error.message : "",
    });
  }

  const format = getDoubaoAudioFormat(input.format);
  if (!format) {
    throw new DoubaoAudioError("不支持的音频输出格式", {
      status: 400,
      code: "INVALID_PARAMETER",
      requestId: input.requestId,
    });
  }

  const references = input.mode === "audio-reference"
    ? input.audioReferences.map((item) => ({ audio_data: item.buffer.toString("base64") }))
    : [];
  const audioConfig = {
    format: format.upstream,
    speech_rate: input.speechRate,
    enable_subtitle: input.enableSubtitle,
  };
  const body = {
    model: DOUBAO_AUDIO_MODEL,
    text_prompt: input.textPrompt,
    ...(references.length ? { references } : {}),
    audio_config: audioConfig,
  };

  let response;
  try {
    response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": config.apiKey,
        "X-Api-Request-Id": input.requestId,
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new DoubaoAudioError("无法连接 Doubao 音频生成服务", {
      status: 502,
      code: "UPSTREAM_CONNECTION_FAILED",
      requestId: input.requestId,
      upstreamMessage: error instanceof Error ? error.message : "",
    });
  }

  const logId = String(response.headers.get("x-tt-logid") || "").trim();
  const data = await response.json().catch(() => null);
  if (!response.ok || (data?.code !== undefined && Number(data.code) !== 0)) {
    throw mapUpstreamError(response, data, input.requestId, logId);
  }
  if (!data || typeof data !== "object" || !logId) {
    throw new DoubaoAudioError("Doubao 音频服务返回了无法识别的数据", {
      code: "INVALID_UPSTREAM_RESPONSE",
      requestId: input.requestId,
      logId,
    });
  }

  const audioBuffer = decodeAudioBase64(data.audio, input.requestId, logId);
  let inspected;
  try {
    inspected = inspectAudioMetadata(audioBuffer, format.id);
  } catch (error) {
    throw new DoubaoAudioError("Doubao 音频服务返回的文件格式不正确", {
      code: "INVALID_AUDIO_FORMAT",
      requestId: input.requestId,
      logId,
      upstreamMessage: error instanceof Error ? error.message : "",
    });
  }
  if (inspected.durationSeconds > DOUBAO_AUDIO_OUTPUT_MAX_DURATION_SECONDS) {
    throw new DoubaoAudioError("Doubao 音频服务返回的音频超过 120 秒", {
      code: "OUTPUT_TOO_LONG",
      requestId: input.requestId,
      logId,
    });
  }
  const duration = normalizeDuration(data.duration, "音频时长", input.requestId, logId);
  const originalDuration = normalizeDuration(
    data.original_duration,
    "原始音频时长",
    input.requestId,
    logId,
  );
  const subtitle = input.enableSubtitle ? normalizeSubtitle(data.subtitle) : null;

  return {
    audioBuffer,
    mimeType: format.mimeType,
    duration,
    originalDuration,
    inspectedDuration: inspected.durationSeconds,
    subtitle,
    requestId: input.requestId,
    logId,
  };
}
