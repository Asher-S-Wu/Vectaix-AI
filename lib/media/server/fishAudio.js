import { resolveFishAudioConfig } from "@/lib/modelRoutes";
import { FISH_AUDIO_MODEL, parseFishSpeechInput } from "@/lib/media/shared/fishAudio";

const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
const VOICE_ID_PATTERN = /^[a-f0-9]{32}$/i;
const VOICE_STATES = new Set(["created", "training", "trained", "failed"]);

export class FishAudioError extends Error {
  constructor(message, { status = 502, code = "FISH_AUDIO_ERROR", requestId = "", upstreamRejected = false } = {}) {
    super(message);
    this.name = "FishAudioError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.upstreamRejected = upstreamRejected;
  }
}

export function fishErrorStatus(error) {
  if (error?.name === "AbortError") return 499;
  const status = Number(error?.status ?? error?.statusCode);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

export function fishPublicMessage(error, defaultMessage) {
  if (error?.name === "AbortError") return "操作已取消";
  return error instanceof FishAudioError || fishErrorStatus(error) < 500 ? error.message : defaultMessage;
}

async function requestConfig() {
  try {
    return await resolveFishAudioConfig();
  } catch {
    throw new FishAudioError("Fish Audio 服务密钥尚未配置", { status: 503, code: "NOT_CONFIGURED", upstreamRejected: true });
  }
}

async function readLimitedBytes(response, maximum) {
  if (Number(response.headers.get("content-length")) > maximum) {
    await response.body?.cancel();
    throw new FishAudioError("Fish Audio 返回内容超过大小限制");
  }
  if (!response.body) throw new FishAudioError("Fish Audio 返回了空内容");
  const chunks = [];
  const reader = response.body.getReader();
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new FishAudioError("Fish Audio 返回内容超过大小限制");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

async function checkResponse(response) {
  if (response.ok) return;
  await response.body?.cancel();
  const messages = {
    400: "Fish Audio 未接受本次参数，请检查文字和音色",
    401: "Fish Audio 服务密钥无效",
    402: "Fish Audio 服务账户余额不足",
    403: "Fish Audio 服务账户权限不足",
    404: "该 Fish Audio 音色已被删除",
    422: "Fish Audio 未接受本次参数，请检查文字和音色",
    429: "Fish Audio 当前请求较多，请稍后再试",
  };
  throw new FishAudioError(messages[response.status] || "Fish Audio 服务请求失败", {
    status: response.status === 401 || response.status === 402 ? 503 : response.status >= 500 ? 502 : response.status,
    code: `UPSTREAM_${response.status}`,
    requestId: response.headers.get("x-request-id") || "",
    upstreamRejected: response.status >= 400 && response.status < 500,
  });
}

async function fishRequest(path, { method = "GET", body, headers, signal, onRequestDispatched } = {}) {
  const config = await requestConfig();
  signal?.throwIfAborted();
  const timeout = AbortSignal.timeout(240000);
  onRequestDispatched?.();
  const response = await fetch(`${config.baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.apiKey}`, ...headers },
    body,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    redirect: "error",
    cache: "no-store",
  });
  await checkResponse(response);
  return response;
}

async function readJson(response) {
  const bytes = await readLimitedBytes(response, 2 * 1024 * 1024);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new FishAudioError("Fish Audio 返回的数据格式有误");
  }
}

export function buildFishSpeechPayload(input) {
  const parsed = parseFishSpeechInput(input);
  return {
    text: parsed.text,
    reference_id: parsed.voiceId,
    format: parsed.format,
    sample_rate: parsed.sampleRate,
    temperature: parsed.temperature,
    top_p: parsed.topP,
    prosody: { speed: parsed.speed, volume: parsed.volume },
    normalize: true,
    latency: "normal",
  };
}

export async function synthesizeFishSpeech(input, { signal, onRequestDispatched, onUpstreamComplete } = {}) {
  const payload = buildFishSpeechPayload(input);
  const response = await fishRequest("/v1/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json", model: FISH_AUDIO_MODEL },
    body: JSON.stringify(payload),
    signal,
    onRequestDispatched,
  });
  const audioBuffer = await readLimitedBytes(response, MAX_AUDIO_BYTES);
  if (!audioBuffer.length) throw new FishAudioError("Fish Audio 返回了空音频");
  const mimeType = payload.format === "wav" ? "audio/wav" : "audio/mpeg";
  const contentType = response.headers.get("content-type") || "";
  if (!/^(audio\/|application\/octet-stream)/i.test(contentType)) {
    throw new FishAudioError("Fish Audio 返回内容并非音频");
  }
  onUpstreamComplete?.();
  return {
    audioBuffer,
    mimeType,
    bytes: Buffer.byteLength(payload.text, "utf8"),
    characters: payload.text.length,
    requestId: response.headers.get("x-request-id") || "",
  };
}

function validateVoiceId(voiceId) {
  if (!VOICE_ID_PATTERN.test(voiceId)) throw new FishAudioError("音色编号无效", { status: 400, upstreamRejected: true });
}

function validateVoice(voice) {
  if (!voice || !VOICE_ID_PATTERN.test(voice._id) || voice.type !== "tts" || !VOICE_STATES.has(voice.state)) {
    throw new FishAudioError("Fish Audio 返回的音色信息有误");
  }
  return voice;
}

export async function getFishVoice(voiceId, { signal } = {}) {
  validateVoiceId(voiceId);
  return validateVoice(await readJson(await fishRequest(`/model/${encodeURIComponent(voiceId)}`, { signal })));
}

export async function createFishVoice({ displayName, sample, signal }) {
  const form = new FormData();
  form.set("type", "tts");
  form.set("train_mode", "fast");
  form.set("title", displayName);
  form.set("visibility", "private");
  form.set("enhance_audio_quality", "true");
  form.set("generate_sample", "false");
  form.set("voices", sample, sample.name);
  return validateVoice(await readJson(await fishRequest("/model", { method: "POST", body: form, signal })));
}

export async function deleteFishVoice(voiceId, { signal } = {}) {
  validateVoiceId(voiceId);
  const response = await fishRequest(`/model/${encodeURIComponent(voiceId)}`, { method: "DELETE", signal });
  await response.body?.cancel();
}
