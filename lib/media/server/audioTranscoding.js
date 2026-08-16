import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import { inspectAudioMetadata } from "@/lib/media/server/audioSampleInspection";
import {
  AUDIO_UPLOAD_PURPOSES,
  getAudioClipLimits,
} from "@/lib/media/shared/audioUploads";

const PROCESS_LIMIT = 2;
const PROBE_TIMEOUT_MS = 20 * 1000;
const TRANSCODE_TIMEOUT_MS = 120 * 1000;
const PROCESS_OUTPUT_MAX_BYTES = 256 * 1024;
const NORMALIZED_AUDIO_MAX_BYTES = 10 * 1024 * 1024;

const FORMAT_NAMES_BY_EXTENSION = Object.freeze({
  wav: new Set(["wav"]),
  mp3: new Set(["mp3"]),
  m4a: new Set(["mov", "mp4", "m4a", "3gp", "3g2", "mj2"]),
  aac: new Set(["aac"]),
  flac: new Set(["flac"]),
  ogg: new Set(["ogg"]),
  opus: new Set(["ogg"]),
  webm: new Set(["matroska", "webm"]),
});
const STATIC_COVER_CODECS = new Set(["mjpeg", "png", "bmp", "webp", "tiff", "gif"]);

const processState = globalThis.__vectaixAudioProcessState || { activeCount: 0 };
globalThis.__vectaixAudioProcessState = processState;

function operationalError(message, status = 400, code = "AUDIO_PROCESSING_FAILED") {
  return Object.assign(new Error(message), { status, code });
}

function abortError() {
  const error = new Error("音频处理已取消");
  error.name = "AbortError";
  return error;
}

function appendLimited(chunks, chunk, currentSize, maxBytes = PROCESS_OUTPUT_MAX_BYTES) {
  if (currentSize >= maxBytes) return currentSize;
  const remaining = maxBytes - currentSize;
  chunks.push(chunk.subarray(0, remaining));
  return currentSize + Math.min(chunk.length, remaining);
}

async function runMediaProcess({
  command,
  args,
  signal,
  timeoutMs,
  failureMessage,
  binaryStdout = false,
  stdoutMaxBytes = PROCESS_OUTPUT_MAX_BYTES,
  stdoutOverflowMessage = "音频信息过多，无法处理",
}) {
  if (!command) {
    throw operationalError("音频转码服务尚未正确安装", 503, "AUDIO_PROCESSOR_UNAVAILABLE");
  }
  if (processState.activeCount >= PROCESS_LIMIT) {
    throw operationalError("当前音频处理任务较多，请稍后再试", 429, "AUDIO_PROCESSOR_BUSY");
  }
  if (signal?.aborted) throw abortError();

  processState.activeCount += 1;
  try {
    return await new Promise((resolve, reject) => {
      let settled = false;
      let stdoutSize = 0;
      let stderrSize = 0;
      let forcedError = null;
      let timeout = null;
      const stdout = [];
      const stderr = [];
      const child = spawn(command, args, {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        callback(value);
      };
      const stop = () => {
        if (!child.killed) child.kill("SIGKILL");
      };
      const stopWithError = (error) => {
        if (settled || forcedError) return;
        forcedError = error;
        stop();
      };
      const onAbort = () => {
        stopWithError(abortError());
      };
      timeout = setTimeout(() => {
        stopWithError(
          operationalError(
            "音频处理超时，请缩短素材后重试",
            504,
            "AUDIO_PROCESSOR_TIMEOUT",
          ),
        );
      }, timeoutMs);
      timeout.unref?.();

      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
      child.stdout.on("data", (chunk) => {
        if (stdoutSize + chunk.length > stdoutMaxBytes) {
          stopWithError(operationalError(stdoutOverflowMessage));
          return;
        }
        stdoutSize = appendLimited(stdout, chunk, stdoutSize, stdoutMaxBytes);
      });
      child.stderr.on("data", (chunk) => {
        stderrSize = appendLimited(stderr, chunk, stderrSize);
      });
      child.once("error", (error) => {
        const unavailable = operationalError(
          "音频转码服务暂时不可用",
          503,
          "AUDIO_PROCESSOR_UNAVAILABLE",
        );
        unavailable.cause = error;
        finish(reject, unavailable);
      });
      child.once("close", (code, closeSignal) => {
        if (settled) return;
        if (forcedError) {
          finish(reject, forcedError);
          return;
        }
        const stdoutBuffer = Buffer.concat(stdout);
        const result = {
          stdout: binaryStdout ? stdoutBuffer : stdoutBuffer.toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        };
        if (code === 0) {
          finish(resolve, result);
          return;
        }
        const processError = operationalError(failureMessage, 400);
        processError.processCode = code;
        processError.processSignal = closeSignal;
        processError.processOutput = result.stderr.slice(-4000);
        finish(reject, processError);
      });
    });
  } finally {
    processState.activeCount = Math.max(0, processState.activeCount - 1);
  }
}

function normalizeStreamedWavHeader(input) {
  const buffer = Buffer.from(input);
  if (
    buffer.length < 44
    || buffer.toString("ascii", 0, 4) !== "RIFF"
    || buffer.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw operationalError("转换后的 WAV 音频无效", 500);
  }

  buffer.writeUInt32LE(buffer.length - 8, 4);
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkType = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    if (chunkType === "data") {
      buffer.writeUInt32LE(buffer.length - offset - 8, offset + 4);
      return buffer;
    }
    const nextOffset = offset + 8 + chunkSize + (chunkSize % 2);
    if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset || nextOffset > buffer.length) {
      break;
    }
    offset = nextOffset;
  }
  throw operationalError("转换后的 WAV 音频无效", 500);
}

function parseDuration(format, audioStream) {
  const candidates = [audioStream?.duration, format?.duration];
  for (const value of candidates) {
    const duration = Number(value);
    if (Number.isFinite(duration) && duration > 0) return duration;
  }
  return 0;
}

function assertExtensionMatchesFormat(extension, formatName) {
  const accepted = FORMAT_NAMES_BY_EXTENSION[extension];
  const detected = new Set(String(formatName || "").split(",").map((item) => item.trim()));
  if (!accepted || !Array.from(accepted).some((item) => detected.has(item))) {
    throw operationalError("文件内容与扩展名不匹配");
  }
}

function assertExtensionMatchesCodec(extension, codecName) {
  const codec = String(codecName || "").trim().toLowerCase();
  if (extension === "opus" && codec !== "opus") {
    throw operationalError("文件内容与 Opus 格式不匹配");
  }
  if (extension === "aac" && codec !== "aac") {
    throw operationalError("文件内容与 AAC 格式不匹配");
  }
  if (extension === "flac" && codec !== "flac") {
    throw operationalError("文件内容与 FLAC 格式不匹配");
  }
}

export async function probeAudioSource({ inputPath, extension, signal }) {
  const probeStartedAt = Date.now();
  const result = await runMediaProcess({
    command: ffprobeInstaller.path,
    args: [
      "-v", "error",
      "-count_packets",
      "-show_format",
      "-show_streams",
      "-print_format", "json",
      inputPath,
    ],
    signal,
    timeoutMs: PROBE_TIMEOUT_MS,
    failureMessage: "无法读取音频，请确认文件未损坏",
  });

  let metadata;
  try {
    metadata = JSON.parse(result.stdout);
  } catch {
    throw operationalError("无法读取音频信息，请确认文件未损坏");
  }

  const streams = Array.isArray(metadata?.streams) ? metadata.streams : [];
  const audioStream = streams.find((stream) => stream?.codec_type === "audio");
  const containsVideo = streams.some((stream) => {
    if (stream?.codec_type !== "video") return false;
    const packetCount = Number(stream.nb_read_packets);
    const isStaticCover = Number(stream?.disposition?.attached_pic) === 1
      && STATIC_COVER_CODECS.has(String(stream.codec_name || "").toLowerCase())
      && packetCount === 1;
    return !isStaticCover;
  });
  if (!audioStream) throw operationalError("文件中没有可用的音频轨道");
  if (containsVideo) throw operationalError("这里只支持音频文件，不能上传视频");

  assertExtensionMatchesFormat(extension, metadata?.format?.format_name);
  assertExtensionMatchesCodec(extension, audioStream.codec_name);
  const duration = parseDuration(metadata?.format, audioStream);
  if (!duration) throw operationalError("无法读取音频时长，请确认文件未损坏");

  const decodeTimeoutMs = PROBE_TIMEOUT_MS - (Date.now() - probeStartedAt);
  if (decodeTimeoutMs <= 0) {
    throw operationalError(
      "音频处理超时，请缩短素材后重试",
      504,
      "AUDIO_PROCESSOR_TIMEOUT",
    );
  }

  await runMediaProcess({
    command: ffmpegPath,
    args: [
      "-nostdin",
      "-hide_banner",
      "-loglevel", "error",
      "-xerror",
      "-i", inputPath,
      "-map", "0:a:0",
      "-vn",
      "-sn",
      "-dn",
      "-f", "null",
      "-",
    ],
    signal,
    timeoutMs: decodeTimeoutMs,
    failureMessage: "音频内容损坏或无法完整解码",
  });

  return {
    duration: Math.round(duration * 1000) / 1000,
    channels: Math.max(1, Number(audioStream.channels) || 1),
    sampleRate: Math.max(1, Number(audioStream.sample_rate) || 1),
    codec: String(audioStream.codec_name || ""),
  };
}

export function validateAudioClip({ purpose, clipStart, clipEnd, sourceDuration }) {
  const limits = getAudioClipLimits(purpose);
  if (!limits) throw operationalError("音频用途无效");
  const roundMilliseconds = (value) => Math.round(Number(value) * 1000) / 1000;
  const start = roundMilliseconds(clipStart);
  const end = roundMilliseconds(clipEnd);
  const duration = roundMilliseconds(sourceDuration);
  if (
    !Number.isFinite(start)
    || !Number.isFinite(end)
    || !Number.isFinite(duration)
    || start < 0
    || end <= start
    || end > duration
  ) {
    throw operationalError("音频片段范围无效");
  }
  const clipDuration = roundMilliseconds(end - start);
  if (clipDuration < limits.minSeconds || clipDuration > limits.maxSeconds) {
    throw operationalError(
      `请选择 ${limits.minSeconds} 至 ${limits.maxSeconds} 秒的音频片段`,
    );
  }
  return {
    start,
    end,
    duration: clipDuration,
  };
}

export async function transcodeAudioClip({
  inputPath,
  purpose,
  clipStart,
  clipEnd,
  sourceMetadata,
  signal,
}) {
  const clip = validateAudioClip({
    purpose,
    clipStart,
    clipEnd,
    sourceDuration: sourceMetadata.duration,
  });
  const isVoiceClone = purpose === AUDIO_UPLOAD_PURPOSES.VOICE_CLONE;
  const sampleRate = isVoiceClone ? 24_000 : 44_100;
  const channels = isVoiceClone ? 1 : Math.min(2, sourceMetadata.channels);
  const result = await runMediaProcess({
    command: ffmpegPath,
    args: [
      "-nostdin",
      "-hide_banner",
      "-loglevel", "error",
      "-ss", clip.start.toFixed(3),
      "-i", inputPath,
      "-t", clip.duration.toFixed(3),
      "-map", "0:a:0",
      "-vn",
      "-sn",
      "-dn",
      "-ac", String(channels),
      "-ar", String(sampleRate),
      "-c:a", "pcm_s16le",
      "-f", "wav",
      "pipe:1",
    ],
    signal,
    timeoutMs: TRANSCODE_TIMEOUT_MS,
    failureMessage: "音频转换失败，请确认文件内容完整",
    binaryStdout: true,
    stdoutMaxBytes: NORMALIZED_AUDIO_MAX_BYTES,
    stdoutOverflowMessage: "转换后的音频仍然超过 10MB，请缩短所选片段",
  });

  const buffer = normalizeStreamedWavHeader(result.stdout);
  if (!buffer.length || buffer.length > NORMALIZED_AUDIO_MAX_BYTES) {
    throw operationalError("转换后的音频仍然超过 10MB，请缩短所选片段");
  }
  const inspected = inspectAudioMetadata(buffer, "wav");
  if (
    inspected.bitDepth !== 16
    || inspected.sampleRate !== sampleRate
    || inspected.channels !== channels
  ) {
    throw operationalError("转换后的音频参数不正确，请重试", 500);
  }
  const outputLimits = getAudioClipLimits(purpose);
  if (
    inspected.durationSeconds < outputLimits.minSeconds
    || inspected.durationSeconds > outputLimits.maxSeconds
  ) {
    throw operationalError("转换后的音频时长不符合要求，请重新选择片段");
  }
  return {
    buffer,
    mimeType: "audio/wav",
    extension: "wav",
    duration: inspected.durationSeconds,
    sampleRate,
    channels,
    clip,
  };
}
