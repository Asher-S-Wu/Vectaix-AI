import crypto from "node:crypto";
import { resolveDoubaoAudioConfig } from "@/lib/modelRoutes";
import { inspectAudioMetadata } from "@/lib/media/server/audioSampleInspection";
import {
  DOUBAO_AUDIO_MODEL,
  DOUBAO_AUDIO_OUTPUT_MAX_BYTES,
  getDoubaoAudioFormat,
} from "@/lib/media/shared/doubaoAudio";

export class DoubaoAudioError extends Error {
  constructor(message, {
    status = 502,
    code = "DOUBAO_AUDIO_ERROR",
    requestId = "",
    upstreamLogId = "",
    upstreamCode = null,
  } = {}) {
    super(message);
    this.name = "DoubaoAudioError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.upstreamLogId = upstreamLogId;
    this.upstreamCode = upstreamCode;
  }
}

function upstreamStatus(response) {
  return response.status >= 400 && response.status <= 599 ? response.status : 502;
}

function decodeStrictBase64(value, context) {
  const encoded = typeof value === "string" ? value.trim() : "";
  const maxEncodedLength = Math.ceil(DOUBAO_AUDIO_OUTPUT_MAX_BYTES / 3) * 4;
  if (
    !encoded
    || encoded.length > maxEncodedLength
    || encoded.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
  ) {
    throw new DoubaoAudioError("豆包音频服务返回的音频内容无效", context);
  }
  const buffer = Buffer.from(encoded, "base64");
  if (
    !buffer.length
    || buffer.length > DOUBAO_AUDIO_OUTPUT_MAX_BYTES
    || buffer.toString("base64") !== encoded
  ) {
    throw new DoubaoAudioError("豆包音频服务返回的音频内容无效", context);
  }
  return buffer;
}

function readDuration(value, label, context) {
  if (typeof value !== "number") {
    throw new DoubaoAudioError(`豆包音频服务返回的${label}无效`, context);
  }
  const duration = value;
  if (!Number.isFinite(duration) || duration <= 0 || duration > 120) {
    throw new DoubaoAudioError(`豆包音频服务返回的${label}无效`, context);
  }
  return Math.round(duration * 1000) / 1000;
}

export async function synthesizeDoubaoSpeech(input, { signal } = {}) {
  const config = resolveDoubaoAudioConfig();
  const requestId = crypto.randomUUID();
  let response;
  try {
    response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "X-Api-Key": config.apiKey,
        "X-Api-Request-Id": requestId,
      },
      body: JSON.stringify({
        model: DOUBAO_AUDIO_MODEL,
        text_prompt: input.textPrompt,
        references: [{ audio_data: input.referenceAudioBase64 }],
        audio_config: {
          format: input.format,
          sample_rate: input.sampleRate,
          speech_rate: input.speechRate,
          loudness_rate: input.loudnessRate,
          pitch_rate: input.pitchRate,
          enable_subtitle: false,
        },
      }),
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new DoubaoAudioError("连接豆包音频服务失败", {
      status: 502,
      code: "NETWORK_ERROR",
      requestId,
    });
  }

  const upstreamLogId = String(response.headers.get("x-tt-logid") || "").trim();
  let data;
  try {
    data = await response.json();
  } catch {
    throw new DoubaoAudioError("豆包音频服务返回了无法识别的内容", {
      status: upstreamStatus(response),
      code: "INVALID_RESPONSE",
      requestId,
      upstreamLogId,
    });
  }

  const context = {
    status: upstreamStatus(response),
    code: "INVALID_RESPONSE",
    requestId,
    upstreamLogId,
  };
  if (!response.ok || data?.code !== 0) {
    throw new DoubaoAudioError(
      String(data?.message || "豆包音频服务调用失败"),
      {
        status: upstreamStatus(response),
        code: "UPSTREAM_ERROR",
        requestId,
        upstreamLogId,
        upstreamCode: Number.isFinite(Number(data?.code)) ? Number(data.code) : null,
      },
    );
  }
  if (!upstreamLogId) {
    throw new DoubaoAudioError("豆包音频服务没有返回请求日志编号", context);
  }

  const format = getDoubaoAudioFormat(input.format);
  if (!format) {
    throw new DoubaoAudioError("豆包音频格式无效", {
      status: 500,
      code: "INVALID_FORMAT",
      requestId,
      upstreamLogId,
    });
  }
  const audioBuffer = decodeStrictBase64(data.audio, context);
  const duration = readDuration(data.duration, "音频时长", context);
  const originalDuration = readDuration(data.original_duration, "原始时长", context);

  let metadata;
  try {
    metadata = inspectAudioMetadata(audioBuffer, input.format);
  } catch (error) {
    throw new DoubaoAudioError(
      /[\u3400-\u9fff]/u.test(error?.message || "")
        ? error.message
        : "豆包音频服务返回的音频格式无效",
      context,
    );
  }
  if (
    metadata.extension !== input.format
    || metadata.mimeType !== format.mimeType
    || metadata.sampleRate !== input.sampleRate
    || metadata.durationSeconds > 120
  ) {
    throw new DoubaoAudioError("豆包音频服务返回的音频格式或参数不正确", context);
  }

  return {
    audioBuffer,
    mimeType: format.mimeType,
    duration,
    originalDuration,
    requestId,
    upstreamLogId,
  };
}
