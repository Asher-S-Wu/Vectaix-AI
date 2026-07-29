import { resolveQwenAudioConfig } from "@/lib/modelRoutes";
import {
  AUDIO_FORMATS,
  AUDIO_INSTRUCTION_MAX_LENGTH,
  AUDIO_LANGUAGE_HINTS,
  AUDIO_MODEL,
  AUDIO_SAMPLE_RATES,
  AUDIO_TEXT_MAX_LENGTH,
} from "@/lib/media/shared/models";
import { normalizeAliyunAudioUrl } from "@/lib/media/storage";

const SYNTHESIS_PATH = "/services/audio/tts/SpeechSynthesizer";
const CUSTOMIZATION_PATH = "/services/audio/tts/customization";
const VOICE_ENROLLMENT_MODEL = "voice-enrollment";
const VOICE_STATUSES = new Set(["DEPLOYING", "OK", "UNDEPLOYED"]);
const LANGUAGE_HINT_SET = new Set(AUDIO_LANGUAGE_HINTS.map((item) => item.id).filter(Boolean));
const FORMAT_SET = new Set(AUDIO_FORMATS);
const SAMPLE_RATE_SET = new Set(AUDIO_SAMPLE_RATES);

export class QwenAudioError extends Error {
  constructor(message, {
    status = 502,
    code = "QWEN_AUDIO_ERROR",
    requestId = "",
    upstreamMessage = "",
  } = {}) {
    super(message);
    this.name = "QwenAudioError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.upstreamMessage = upstreamMessage;
  }
}

export function isMissingCustomVoiceError(error) {
  if (!(error instanceof QwenAudioError)) return false;
  const source = `${error.code || ""} ${error.upstreamMessage || ""}`.toLowerCase();
  return (
    /voice[^a-z0-9]*(?:not[^a-z0-9]*(?:found|exist)|does[^a-z0-9]*not[^a-z0-9]*exist)/.test(source)
    || /(?:not[^a-z0-9]*(?:found|exist)|does[^a-z0-9]*not[^a-z0-9]*exist)[^a-z0-9]*voice/.test(source)
    || /音色不存在|音色已删除/.test(source)
  );
}

function getUpstreamErrorDetails(data) {
  return {
    code: String(data?.code || data?.error?.code || "").trim(),
    message: String(data?.message || data?.error?.message || "").trim(),
    requestId: String(data?.request_id || data?.requestId || "").trim(),
  };
}

function createMappedUpstreamError(response, data, operation) {
  const details = getUpstreamErrorDetails(data);
  const source = `${details.code} ${details.message}`.toLowerCase();
  const requestId = details.requestId || response.headers.get("x-request-id") || "";

  if (
    response.status === 401
    || /invalid.*api.?key|invalidaccesskey|unauthorized|authentication/.test(source)
  ) {
    return new QwenAudioError("语音服务密钥无效，或密钥不属于新加坡地域", {
      status: 503,
      code: details.code || "INVALID_API_KEY",
      requestId,
      upstreamMessage: details.message,
    });
  }
  if (
    response.status === 403
    || /permission|access.?denied|forbidden|not.?authorized|model.*not.*permission/.test(source)
  ) {
    return new QwenAudioError("当前阿里云账号无权使用该语音服务", {
      status: 403,
      code: details.code || "PERMISSION_DENIED",
      requestId,
      upstreamMessage: details.message,
    });
  }
  if (
    response.status === 429
    || /throttl|rate.?limit|too many request|quota/.test(source)
  ) {
    return new QwenAudioError("语音服务请求过于频繁，请稍后再试", {
      status: 429,
      code: details.code || "RATE_LIMITED",
      requestId,
      upstreamMessage: details.message,
    });
  }
  if (
    /engine error.*411|tts speak operation failed|invalid.*voice|voice.*not.*support|voice.*model/.test(source)
  ) {
    return new QwenAudioError("所选音色不支持 Qwen Audio 3.0 TTS Plus", {
      status: 400,
      code: details.code || "VOICE_MODEL_MISMATCH",
      requestId,
      upstreamMessage: details.message,
    });
  }
  if (response.status === 400 || /invalidparameter|invalid.?parameter|bad.?request/.test(source)) {
    const message = operation === "synthesis"
      ? "语音合成参数不符合要求"
      : "复刻样本或音色参数不符合要求";
    return new QwenAudioError(message, {
      status: 400,
      code: details.code || "INVALID_PARAMETER",
      requestId,
      upstreamMessage: details.message,
    });
  }
  if (response.status >= 500) {
    return new QwenAudioError("语音服务暂时不可用", {
      status: 502,
      code: details.code || "UPSTREAM_UNAVAILABLE",
      requestId,
      upstreamMessage: details.message,
    });
  }
  return new QwenAudioError("语音服务请求失败", {
    status: response.status >= 400 && response.status < 500 ? response.status : 502,
    code: details.code || "UPSTREAM_ERROR",
    requestId,
    upstreamMessage: details.message,
  });
}

async function postDashScope(path, body, { signal, operation } = {}) {
  let config;
  try {
    config = resolveQwenAudioConfig();
  } catch (error) {
    throw new QwenAudioError("语音服务密钥尚未配置", {
      status: 500,
      code: "MISSING_API_KEY",
      upstreamMessage: error?.message || "",
    });
  }
  const { apiKey, baseUrl } = config;
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new QwenAudioError("无法连接语音服务", {
      status: 502,
      code: "UPSTREAM_CONNECTION_FAILED",
      upstreamMessage: error?.message || "",
    });
  }

  const data = await response.json().catch(() => null);
  if (!response.ok || data?.code || data?.error?.code) {
    throw createMappedUpstreamError(response, data, operation);
  }
  if (!data || typeof data !== "object") {
    throw new QwenAudioError("语音服务返回了无法识别的数据", {
      status: 502,
      code: "INVALID_UPSTREAM_RESPONSE",
      requestId: response.headers.get("x-request-id") || "",
    });
  }
  return data;
}

function requireString(value, label, maxLength = 200) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new QwenAudioError(`${label}不能为空`, { status: 400, code: "INVALID_PARAMETER" });
  if (normalized.length > maxLength) {
    throw new QwenAudioError(`${label}长度超出限制`, { status: 400, code: "INVALID_PARAMETER" });
  }
  return normalized;
}

function normalizeNumber(value, label, min, max, fallback) {
  const number = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new QwenAudioError(`${label}不在允许范围内`, { status: 400, code: "INVALID_PARAMETER" });
  }
  return number;
}

function normalizeLanguageHint(value, fallback = "") {
  const normalized = String(value || fallback).trim();
  if (!normalized) return "";
  if (!LANGUAGE_HINT_SET.has(normalized)) {
    throw new QwenAudioError("语言选项不受支持", { status: 400, code: "INVALID_PARAMETER" });
  }
  return normalized;
}

function normalizeHttpsAudioUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    throw new QwenAudioError("复刻样本地址无效", { status: 400, code: "INVALID_PARAMETER" });
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new QwenAudioError("复刻样本地址必须使用 HTTPS", { status: 400, code: "INVALID_PARAMETER" });
  }
  return parsed.toString();
}

function normalizeAliyunResultUrl(value) {
  return normalizeAliyunAudioUrl(value);
}

function parseDashScopeDate(value) {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(value))
    ? `${String(value).replace(" ", "T")}+08:00`
    : value;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function requireUpstreamRequestId(data) {
  const requestId = data?.request_id;
  if (typeof requestId !== "string" || !requestId.trim()) {
    throw new QwenAudioError("语音服务返回结果缺少请求 ID", {
      status: 502,
      code: "INVALID_UPSTREAM_RESPONSE",
    });
  }
  return requestId.trim();
}

function requireUpstreamDate(value, requestId) {
  const parsed = parseDashScopeDate(value);
  if (!parsed) {
    throw new QwenAudioError("语音服务返回了无效的音色时间", {
      status: 502,
      code: "INVALID_UPSTREAM_RESPONSE",
      requestId,
    });
  }
  return parsed;
}

export async function synthesizeSpeech(input, { signal } = {}) {
  const text = String(input?.text || "");
  if (!text.trim()) {
    throw new QwenAudioError("待合成文本不能为空", { status: 400, code: "INVALID_PARAMETER" });
  }
  if (text.length > AUDIO_TEXT_MAX_LENGTH) {
    throw new QwenAudioError(`待合成文本不能超过 ${AUDIO_TEXT_MAX_LENGTH} 个字符`, {
      status: 400,
      code: "INVALID_PARAMETER",
    });
  }

  const voice = requireString(input?.voiceId, "音色");
  const format = String(input?.format || "mp3").toLowerCase();
  if (!FORMAT_SET.has(format)) {
    throw new QwenAudioError("音频格式仅支持 MP3 或 WAV", { status: 400, code: "INVALID_PARAMETER" });
  }
  const sampleRate = Number(input?.sampleRate ?? 24000);
  if (!SAMPLE_RATE_SET.has(sampleRate)) {
    throw new QwenAudioError("采样率仅支持 16、24 或 48 kHz", { status: 400, code: "INVALID_PARAMETER" });
  }
  const rate = normalizeNumber(input?.rate, "语速", 0.5, 2, 1);
  const pitch = normalizeNumber(input?.pitch, "音调", 0.5, 2, 1);
  const volume = normalizeNumber(input?.volume, "音量", 0, 100, 50);
  const languageHint = normalizeLanguageHint(input?.languageHint);
  const instruction = String(input?.instruction || "").trim();
  if (instruction.length > AUDIO_INSTRUCTION_MAX_LENGTH) {
    throw new QwenAudioError(`表达要求不能超过 ${AUDIO_INSTRUCTION_MAX_LENGTH} 个字符`, {
      status: 400,
      code: "INVALID_PARAMETER",
    });
  }

  const synthesisInput = {
    text,
    voice,
    format,
    sample_rate: sampleRate,
    volume,
    rate,
    pitch,
    ...(languageHint ? { language_hints: [languageHint] } : {}),
    ...(instruction ? { instruction } : {}),
  };
  const data = await postDashScope(
    SYNTHESIS_PATH,
    { model: AUDIO_MODEL, input: synthesisInput },
    { signal, operation: "synthesis" }
  );
  const audioUrl = normalizeAliyunResultUrl(data?.output?.audio?.url);
  if (!audioUrl) {
    throw new QwenAudioError("语音服务没有返回安全有效的音频地址", {
      status: 502,
      code: "INVALID_AUDIO_URL",
      requestId: String(data?.request_id || ""),
    });
  }
  const requestId = requireUpstreamRequestId(data);
  const characters = data?.usage?.characters;
  if (!Number.isInteger(characters) || characters < 0) {
    throw new QwenAudioError("语音服务返回了无效的计费字符数", {
      status: 502,
      code: "INVALID_UPSTREAM_RESPONSE",
      requestId,
    });
  }
  return {
    audioUrl,
    requestId,
    usageCharacters: characters,
  };
}

export async function createCustomVoice({
  audioUrl,
  languageHint = "zh",
  enablePreprocess = false,
  prefix,
}, { signal } = {}) {
  const normalizedPrefix = requireString(prefix, "音色前缀", 10);
  if (!/^[A-Za-z0-9]+$/.test(normalizedPrefix)) {
    throw new QwenAudioError("音色前缀只能包含英文字母和数字", {
      status: 400,
      code: "INVALID_PARAMETER",
    });
  }
  const normalizedLanguage = normalizeLanguageHint(languageHint, "zh");
  const enrollmentInput = {
    action: "create_voice",
    target_model: AUDIO_MODEL,
    prefix: normalizedPrefix,
    url: normalizeHttpsAudioUrl(audioUrl),
    language_hints: [normalizedLanguage],
    enable_preprocess: Boolean(enablePreprocess),
  };
  const data = await postDashScope(
    CUSTOMIZATION_PATH,
    { model: VOICE_ENROLLMENT_MODEL, input: enrollmentInput },
    { signal, operation: "voice" }
  );
  const upstreamVoiceId = data?.output?.voice_id;
  if (typeof upstreamVoiceId !== "string" || !upstreamVoiceId.trim()) {
    throw new QwenAudioError("语音服务没有返回复刻音色 ID", {
      status: 502,
      code: "INVALID_UPSTREAM_RESPONSE",
      requestId: String(data?.request_id || ""),
    });
  }
  return {
    voiceId: upstreamVoiceId.trim(),
    requestId: requireUpstreamRequestId(data),
  };
}

export async function queryCustomVoice(voiceId, { signal } = {}) {
  const normalizedVoiceId = requireString(voiceId, "音色 ID");
  const data = await postDashScope(
    CUSTOMIZATION_PATH,
    {
      model: VOICE_ENROLLMENT_MODEL,
      input: {
        action: "query_voice",
        voice_id: normalizedVoiceId,
      },
    },
    { signal, operation: "voice" }
  );
  const status = String(data?.output?.status || "").toUpperCase();
  if (!VOICE_STATUSES.has(status)) {
    throw new QwenAudioError("语音服务返回了未知的音色状态", {
      status: 502,
      code: "INVALID_VOICE_STATUS",
      requestId: String(data?.request_id || ""),
    });
  }
  if (data?.output?.target_model !== AUDIO_MODEL) {
    throw new QwenAudioError("复刻音色绑定的模型与当前语音模型不一致", {
      status: 409,
      code: "VOICE_MODEL_MISMATCH",
      requestId: String(data?.request_id || ""),
    });
  }
  const requestId = requireUpstreamRequestId(data);
  return {
    status,
    createdAt: requireUpstreamDate(data?.output?.gmt_create, requestId),
    modifiedAt: requireUpstreamDate(data?.output?.gmt_modified, requestId),
    requestId,
  };
}

export async function updateCustomVoice({ voiceId, audioUrl }, { signal } = {}) {
  const normalizedVoiceId = requireString(voiceId, "音色 ID");
  const data = await postDashScope(
    CUSTOMIZATION_PATH,
    {
      model: VOICE_ENROLLMENT_MODEL,
      input: {
        action: "update_voice",
        voice_id: normalizedVoiceId,
        url: normalizeHttpsAudioUrl(audioUrl),
      },
    },
    { signal, operation: "voice" }
  );
  return { requestId: requireUpstreamRequestId(data) };
}

export async function deleteCustomVoice(voiceId, { signal } = {}) {
  const normalizedVoiceId = requireString(voiceId, "音色 ID");
  const data = await postDashScope(
    CUSTOMIZATION_PATH,
    {
      model: VOICE_ENROLLMENT_MODEL,
      input: {
        action: "delete_voice",
        voice_id: normalizedVoiceId,
      },
    },
    { signal, operation: "voice" }
  );
  return { requestId: requireUpstreamRequestId(data) };
}
