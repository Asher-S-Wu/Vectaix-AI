import { resolveMinimaxAudioConfig } from "@/lib/modelRoutes";
import {
  MINIMAX_AUDIO_MANAGEMENT_MODEL,
} from "@/lib/media/shared/minimaxAudio";

export class MinimaxAudioError extends Error {
  constructor(message, {
    status = 502,
    code = "MINIMAX_AUDIO_ERROR",
    requestId = "",
    traceId = "",
    upstreamCode = null,
  } = {}) {
    super(message);
    this.name = "MinimaxAudioError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.traceId = traceId;
    this.upstreamCode = upstreamCode;
  }
}

export function isMissingMinimaxVoiceError(error) {
  const message = String(error?.message || "").toLowerCase();
  return error instanceof MinimaxAudioError
    && /voice.*(?:not found|not exist)|(?:not found|not exist).*voice|音色.*不存在/.test(message);
}

function statusForUpstreamCode(code) {
  if (code === 1001) return 504;
  if (code === 1002 || code === 1039) return 429;
  if (code === 1042 || code === 2013) return 400;
  if (code === 2038) return 403;
  return 502;
}

function readUsageCharacters(data, { requestId = "", traceId = "" } = {}) {
  const extra = data?.output?.extra_info || {};
  const characters = data?.usage?.characters ?? extra?.usage_characters;
  if (!Number.isSafeInteger(characters) || characters <= 0) {
    throw new MinimaxAudioError("MiniMax 返回的计费字符用量无效", {
      status: 502,
      code: "INVALID_USAGE",
      requestId,
      traceId,
    });
  }
  return characters;
}

async function callMinimax({ model, input, signal, onRequestDispatched }) {
  const config = resolveMinimaxAudioConfig();
  if (signal?.aborted) {
    throw signal.reason || Object.assign(new Error("MiniMax 请求已取消"), { name: "AbortError" });
  }
  let response;
  try {
    const pending = fetch(config.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ model, input }),
      signal,
    });
    onRequestDispatched?.();
    response = await pending;
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new MinimaxAudioError("连接 MiniMax 语音服务失败", { status: 502, code: "NETWORK_ERROR" });
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new MinimaxAudioError("MiniMax 语音服务返回了无法识别的内容", {
      status: response.ok ? 502 : response.status,
      code: "INVALID_RESPONSE",
    });
  }

  const base = data?.output?.base_resp;
  const upstreamCode = Number(base?.status_code);
  const requestId = String(data?.request_id || "");
  const traceId = String(data?.output?.trace_id || "");
  if (!response.ok || upstreamCode !== 0) {
    const message = String(base?.status_msg || data?.message || "MiniMax 语音服务调用失败");
    throw new MinimaxAudioError(message, {
      status: response.ok ? statusForUpstreamCode(upstreamCode) : response.status,
      code: "UPSTREAM_ERROR",
      requestId,
      traceId,
      upstreamCode: Number.isFinite(upstreamCode) ? upstreamCode : null,
    });
  }
  return { data, requestId, traceId };
}

export async function listMinimaxSystemVoices({ signal } = {}) {
  const { data, requestId } = await callMinimax({
    model: MINIMAX_AUDIO_MANAGEMENT_MODEL,
    input: { action: "get_voice", voice_type: "system" },
    signal,
  });
  const voices = Array.isArray(data?.output?.system_voice) ? data.output.system_voice : [];
  return {
    requestId,
    voices: voices.map((voice) => ({
      id: String(voice?.voice_id || "").trim(),
      voiceId: String(voice?.voice_id || "").trim(),
      name: String(voice?.voice_name || voice?.voice_id || "系统音色").trim(),
      kind: "system",
      description: Array.isArray(voice?.description)
        ? voice.description.map((item) => String(item)).filter(Boolean)
        : [],
      createdAt: voice?.created_time || null,
    })).filter((voice) => voice.voiceId),
  };
}

export async function synthesizeMinimaxSpeech(input, { signal, onRequestDispatched } = {}) {
  const voiceSetting = {
    voice_id: input.voiceId,
    speed: input.speed,
    vol: input.volume,
    pitch: input.pitch,
    text_normalization: false,
  };
  if (input.emotion) voiceSetting.emotion = input.emotion;
  const synthesisInput = {
    text: input.text,
    voice_setting: voiceSetting,
    audio_setting: {
      sample_rate: input.sampleRate,
      bitrate: 128000,
      format: input.format,
      channel: 1,
    },
    subtitle_enable: false,
    output_format: "url",
    aigc_watermark: false,
  };
  if (input.languageBoost) synthesisInput.language_boost = input.languageBoost;

  const { data, requestId, traceId } = await callMinimax({
    model: input.model,
    input: synthesisInput,
    signal,
    onRequestDispatched,
  });
  const audioUrl = String(data?.output?.data?.audio || "").trim();
  if (!audioUrl) {
    throw new MinimaxAudioError("MiniMax 语音生成完成，但没有返回音频", {
      status: 502,
      code: "MISSING_AUDIO",
      requestId,
      traceId,
    });
  }
  const extra = data?.output?.extra_info || {};
  return {
    audioUrl,
    requestId,
    traceId,
    characters: readUsageCharacters(data, { requestId, traceId }),
    durationMs: Number(extra?.audio_length) || 0,
  };
}

export async function createMinimaxVoice(input, { signal, onRequestDispatched } = {}) {
  const cloneInput = {
    action: "voice_clone",
    voice_id: input.voiceId,
    audio_url: input.audioUrl,
    text: input.demoText,
    need_noise_reduction: input.noiseReduction,
    need_volume_normalization: input.volumeNormalization,
    aigc_watermark: false,
  };
  if (input.languageBoost) cloneInput.language_boost = input.languageBoost;
  const { data, requestId, traceId } = await callMinimax({
    model: input.model,
    input: cloneInput,
    signal,
    onRequestDispatched,
  });
  const demoAudioUrl = String(data?.output?.demo_audio || "").trim();
  if (!demoAudioUrl) {
    throw new MinimaxAudioError("声音复刻完成，但没有返回试听音频", {
      status: 502,
      code: "MISSING_DEMO_AUDIO",
      requestId,
    });
  }
  return {
    demoAudioUrl,
    requestId,
    traceId,
    characters: readUsageCharacters(data, { requestId, traceId }),
  };
}

export async function deleteMinimaxVoice(voiceId, { signal } = {}) {
  const { data, requestId } = await callMinimax({
    model: MINIMAX_AUDIO_MANAGEMENT_MODEL,
    input: {
      action: "delete_voice",
      voice_type: "voice_cloning",
      voice_id: voiceId,
    },
    signal,
  });
  return {
    voiceId: String(data?.output?.voice_id || voiceId),
    requestId,
  };
}
