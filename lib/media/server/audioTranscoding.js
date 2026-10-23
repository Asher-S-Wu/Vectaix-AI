import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

const PROCESS_LIMIT = 2;
const PROBE_TIMEOUT_MS = 20 * 1000;
const PROCESS_OUTPUT_MAX_BYTES = 256 * 1024;

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
