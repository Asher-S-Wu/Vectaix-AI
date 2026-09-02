import { spawn } from "node:child_process";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

const PROBE_TIMEOUT_MS = 30 * 1000;
const OUTPUT_LIMIT = 128 * 1024;

function videoError(message, status = 400, code = "VIDEO_METADATA_INVALID") {
  return Object.assign(new Error(message), { status, code });
}

export async function probeVideoDuration(inputPath, { signal } = {}) {
  if (!ffprobeInstaller.path) throw videoError("视频检测服务未安装", 503, "VIDEO_PROBE_UNAVAILABLE");
  if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
  const output = await new Promise((resolve, reject) => {
    const child = spawn(ffprobeInstaller.path, [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "json",
      inputPath,
    ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      callback(value);
    };
    const abort = () => {
      child.kill("SIGKILL");
      finish(reject, signal.reason || new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(reject, videoError("读取视频时长超时", 504, "VIDEO_PROBE_TIMEOUT"));
    }, PROBE_TIMEOUT_MS);
    timer.unref?.();
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => {
      if (stdout.length < OUTPUT_LIMIT) stdout += chunk.toString("utf8").slice(0, OUTPUT_LIMIT - stdout.length);
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < OUTPUT_LIMIT) stderr += chunk.toString("utf8").slice(0, OUTPUT_LIMIT - stderr.length);
    });
    child.once("error", (error) => finish(reject, error));
    child.once("close", (code) => {
      if (code !== 0) {
        finish(reject, videoError(stderr.trim() || "无法读取视频时长"));
        return;
      }
      finish(resolve, stdout);
    });
  });
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw videoError("视频时长信息格式错误");
  }
  const duration = Number(parsed?.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw videoError("无法读取视频时长");
  return Math.round(duration * 1000) / 1000;
}

