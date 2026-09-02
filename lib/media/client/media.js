import {
  notifyCreditFromPayload,
  notifyCreditFromResponseHeaders,
} from "@/lib/client/credits/events";
import { creditOperationHeaders } from "@/lib/client/credits/operations";

async function readJson(response) {
  try {
    const payload = await response.json();
    notifyCreditFromPayload(payload);
    notifyCreditFromResponseHeaders(response);
    return payload;
  } catch {
    return {};
  }
}

function getMessage(data, fallback) {
  return data?.message || data?.error || fallback;
}

async function audioFetch(url, options, networkMessage) {
  try {
    return await fetch(url, options);
  } catch {
    throw new Error(networkMessage);
  }
}

async function videoFetch(url, options, networkMessage) {
  try {
    return await fetch(url, options);
  } catch {
    throw new Error(networkMessage);
  }
}

export async function generateImage(input) {
  const response = await fetch("/api/media/image", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...creditOperationHeaders() },
    body: JSON.stringify(input),
  });
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(getMessage(data, "图片生成失败"));
  }
  if (!data.imageUrl) {
    throw new Error("图片生成完成，但没有返回结果");
  }
  return String(data.imageUrl);
}

export async function editImage({ prompt, size, images }) {
  const formData = new FormData();
  formData.append("prompt", prompt);
  formData.append("size", size);
  images.forEach((image) => formData.append("images", image));

  const response = await fetch("/api/media/image/edit", {
    method: "POST",
    headers: creditOperationHeaders(),
    body: formData,
  });
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(getMessage(data, "图片编辑失败"));
  }
  if (!data.imageUrl) {
    throw new Error("图片编辑完成，但没有返回结果");
  }
  return String(data.imageUrl);
}

export async function uploadVideoSource(file) {
  const response = await videoFetch("/api/media/video/sources", {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name || "source"),
    },
    body: file,
  }, "网络连接失败，暂时无法上传视频素材");
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(getMessage(data, "视频素材上传失败"));
  }
  if (!data?.source?.fileId) {
    throw new Error("视频素材上传完成，但没有返回文件信息");
  }
  return data.source;
}

export async function deleteVideoSource(fileId) {
  if (!fileId) return false;
  const response = await videoFetch(`/api/media/video/sources/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
  }, "网络连接失败，暂时无法清理视频素材");
  if (response.ok) return true;
  const data = await readJson(response);
  throw new Error(getMessage(data, "清理视频素材失败"));
}

export async function createVideoTask(input) {
  const response = await videoFetch("/api/media/video/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...creditOperationHeaders() },
    body: JSON.stringify(input),
  }, "网络连接失败，暂时无法创建视频任务");
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(getMessage(data, "视频任务创建失败"));
  }
  if (!data.task) {
    throw new Error("视频任务创建完成，但没有返回任务信息");
  }
  return data.task;
}

export async function listVideoTasks() {
  const response = await videoFetch("/api/media/video/tasks", {
    method: "GET",
  }, "网络连接失败，暂时无法读取视频任务");
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(getMessage(data, "读取视频任务失败"));
  }
  return Array.isArray(data.tasks) ? data.tasks : [];
}

export async function getVideoTask(taskId) {
  const response = await videoFetch(`/api/media/video/tasks/${encodeURIComponent(taskId)}`, {
    method: "GET",
  }, "网络连接失败，暂时无法查询视频任务");
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(getMessage(data, "查询视频任务失败"));
  }
  if (!data.task) {
    throw new Error("没有返回任务信息");
  }
  return data.task;
}

export async function deleteVideoTask(taskId) {
  const response = await videoFetch(`/api/media/video/tasks/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
  }, "网络连接失败，暂时无法删除视频任务");
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(getMessage(data, "处理视频任务失败"));
  }
  return data;
}

async function videoEnhancementFetch(url, options, networkMessage) {
  try {
    return await fetch(url, options);
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new Error(networkMessage);
  }
}

function videoEnhancementAbortError() {
  const error = new Error("视频上传已取消");
  error.name = "AbortError";
  return error;
}

export async function requestVideoEnhancementUpload(input, { signal } = {}) {
  const response = await videoEnhancementFetch(
    "/api/media/video-enhancement/uploads",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal,
    },
    "网络连接失败，暂时无法准备视频上传",
  );
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(getMessage(data, "准备视频上传失败"));
  }
  const upload = data?.upload;
  if (
    !upload?.id
    || upload.method !== "PUT"
    || typeof upload.uploadUrl !== "string"
    || !upload.uploadUrl
    || !Array.isArray(upload.uploadHeaders)
    || upload.uploadHeaders.some((header) => (
      typeof header?.key !== "string" || typeof header?.value !== "string"
    ))
  ) {
    throw new Error("视频上传凭证不完整，请重新提交");
  }
  return upload;
}

export function uploadVideoEnhancementFile(file, upload, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(videoEnhancementAbortError());
      return;
    }

    const request = new XMLHttpRequest();
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      request.upload.onprogress = null;
      request.onload = null;
      request.onerror = null;
      request.onabort = null;
      callback(value);
    };
    const abort = () => {
      try {
        request.abort();
      } catch {
        finish(reject, videoEnhancementAbortError());
      }
    };

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || typeof onProgress !== "function") return;
      onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        if (typeof onProgress === "function") onProgress(100);
        finish(resolve, true);
        return;
      }
      finish(reject, new Error("视频上传失败，请重新提交"));
    };
    request.onerror = () => finish(reject, new Error("网络连接失败，视频上传未完成"));
    request.onabort = () => finish(reject, videoEnhancementAbortError());
    signal?.addEventListener("abort", abort, { once: true });
    try {
      request.open(upload.method, upload.uploadUrl, true);
      request.withCredentials = false;
      for (const header of upload.uploadHeaders) {
        request.setRequestHeader(header.key, header.value);
      }
      request.send(file);
    } catch {
      finish(reject, new Error("视频上传无法启动，请重新提交"));
    }
  });
}

export async function confirmVideoEnhancementUpload(uploadId, { signal } = {}) {
  const response = await videoEnhancementFetch(
    `/api/media/video-enhancement/uploads/${encodeURIComponent(uploadId)}`,
    { method: "PATCH", signal },
    "网络连接失败，暂时无法确认视频上传",
  );
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(getMessage(data, "确认视频上传失败"));
  }
  if (!data?.upload?.id) throw new Error("视频上传确认完成，但没有返回凭证信息");
  return data.upload;
}

export async function abandonVideoEnhancementUpload(uploadId) {
  if (!uploadId) return false;
  const response = await videoEnhancementFetch(
    `/api/media/video-enhancement/uploads/${encodeURIComponent(uploadId)}`,
    { method: "DELETE", keepalive: true },
    "网络连接失败，暂时无法清理视频上传",
  );
  if (response.ok || response.status === 404 || response.status === 409) return true;
  const data = await readJson(response);
  throw new Error(getMessage(data, "清理视频上传失败"));
}

export async function createVideoEnhancementTask(input) {
  const response = await videoEnhancementFetch(
    "/api/media/video-enhancement/tasks",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...creditOperationHeaders() },
      body: JSON.stringify(input),
      keepalive: true,
    },
    "网络连接失败，暂时无法创建画质增强任务",
  );
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(getMessage(data, "创建画质增强任务失败"));
  }
  if (!data?.task?.id) throw new Error("任务已提交，但没有返回任务信息");
  return data.task;
}

export async function listVideoEnhancementTasks() {
  const response = await videoEnhancementFetch(
    "/api/media/video-enhancement/tasks",
    { method: "GET" },
    "网络连接失败，暂时无法读取画质增强记录",
  );
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(getMessage(data, "读取画质增强记录失败"));
  }
  return Array.isArray(data.tasks) ? data.tasks : [];
}

export async function getVideoEnhancementTask(taskId) {
  const response = await videoEnhancementFetch(
    `/api/media/video-enhancement/tasks/${encodeURIComponent(taskId)}`,
    { method: "GET" },
    "网络连接失败，暂时无法读取画质增强任务",
  );
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(getMessage(data, "读取画质增强任务失败"));
  }
  if (!data?.task?.id) throw new Error("没有返回画质增强任务信息");
  return data.task;
}

export async function deleteVideoEnhancementTask(taskId) {
  const response = await videoEnhancementFetch(
    `/api/media/video-enhancement/tasks/${encodeURIComponent(taskId)}`,
    { method: "DELETE" },
    "网络连接失败，暂时无法删除画质增强任务",
  );
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(getMessage(data, "删除画质增强任务失败"));
  }
  return data;
}

const CLIENT_AUDIO_UPLOAD_LIMIT = 2;
let activeAudioUploadCount = 0;
const pendingAudioUploads = [];

function clientAbortError() {
  const error = new Error("音频上传已取消");
  error.name = "AbortError";
  return error;
}

function releaseAudioUploadSlot() {
  activeAudioUploadCount = Math.max(0, activeAudioUploadCount - 1);
  const next = pendingAudioUploads.shift();
  if (next) next();
}

function acquireAudioUploadSlot(signal) {
  if (signal?.aborted) return Promise.reject(clientAbortError());
  if (activeAudioUploadCount < CLIENT_AUDIO_UPLOAD_LIMIT) {
    activeAudioUploadCount += 1;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const start = () => {
      signal?.removeEventListener("abort", cancel);
      activeAudioUploadCount += 1;
      resolve();
    };
    const cancel = () => {
      const index = pendingAudioUploads.indexOf(start);
      if (index >= 0) pendingAudioUploads.splice(index, 1);
      reject(clientAbortError());
    };
    pendingAudioUploads.push(start);
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

function sendAudioSource(file, purpose, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    const cleanup = () => signal?.removeEventListener("abort", abort);
    request.open(
      "POST",
      `/api/media/audio/uploads?purpose=${encodeURIComponent(purpose)}`,
    );
    request.responseType = "json";
    request.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    request.setRequestHeader("X-File-Name", encodeURIComponent(file.name || "audio"));
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || typeof onProgress !== "function") return;
      onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };
    request.onload = () => {
      cleanup();
      const data = request.response || {};
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(getMessage(data, "音频上传或识别失败")));
        return;
      }
      if (!data?.upload?.fileId) {
        reject(new Error("音频上传完成，但没有返回文件信息"));
        return;
      }
      resolve(data.upload);
    };
    request.onerror = () => {
      cleanup();
      reject(new Error("网络连接失败，暂时无法上传音频"));
    };
    request.onabort = () => {
      cleanup();
      const error = new Error("音频上传已取消");
      error.name = "AbortError";
      reject(error);
    };
    if (signal?.aborted) {
      request.onabort = null;
      reject(clientAbortError());
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    request.send(file);
  });
}

export async function uploadAudioSource(file, purpose, options = {}) {
  await acquireAudioUploadSlot(options.signal);
  try {
    return await sendAudioSource(file, purpose, options);
  } finally {
    releaseAudioUploadSlot();
  }
}

export async function deleteAudioSource(fileId, { keepalive = false } = {}) {
  if (!fileId) return false;
  const response = await audioFetch(
    `/api/media/audio/uploads/${encodeURIComponent(fileId)}`,
    { method: "DELETE", keepalive },
    "网络连接失败，暂时无法清理临时音频",
  );
  if (response.ok || response.status === 404) return true;
  const data = await readJson(response);
  throw new Error(getMessage(data, "清理临时音频失败"));
}

export async function createAudioGeneration(input) {
  const response = await audioFetch("/api/media/audio/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...creditOperationHeaders() },
    body: JSON.stringify(input),
  }, "网络连接失败，暂时无法生成语音");
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(getMessage(data, "语音生成失败"));
  }
  if (!data.generation) {
    throw new Error("语音生成完成，但没有返回生成记录");
  }
  return data.generation;
}

export async function listAudioGenerations() {
  const response = await audioFetch("/api/media/audio/generations", {
    method: "GET",
  }, "网络连接失败，暂时无法读取语音记录");
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(getMessage(data, "读取语音记录失败"));
  }
  return Array.isArray(data.generations) ? data.generations : [];
}

export async function deleteAudioGeneration(generationId) {
  const response = await audioFetch(`/api/media/audio/generations/${encodeURIComponent(generationId)}`, {
    method: "DELETE",
  }, "网络连接失败，暂时无法删除语音记录");
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(getMessage(data, "删除语音记录失败"));
  }
  return data;
}

export async function createMinimaxAudioGeneration(input) {
  const response = await audioFetch("/api/media/audio/minimax/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...creditOperationHeaders() },
    body: JSON.stringify(input),
  }, "网络连接失败，暂时无法生成 MiniMax 语音");
  const data = await readJson(response);
  if (!response.ok) throw new Error(getMessage(data, "MiniMax 语音生成失败"));
  if (!data.generation) throw new Error("语音生成完成，但没有返回生成记录");
  return data.generation;
}

export async function listMinimaxAudioGenerations() {
  const response = await audioFetch("/api/media/audio/minimax/generations", {
    method: "GET",
  }, "网络连接失败，暂时无法读取 MiniMax 语音记录");
  const data = await readJson(response);
  if (!response.ok) throw new Error(getMessage(data, "读取 MiniMax 语音记录失败"));
  return Array.isArray(data.generations) ? data.generations : [];
}

export async function deleteMinimaxAudioGeneration(generationId) {
  const response = await audioFetch(
    `/api/media/audio/minimax/generations/${encodeURIComponent(generationId)}`,
    { method: "DELETE" },
    "网络连接失败，暂时无法删除 MiniMax 语音记录",
  );
  const data = await readJson(response);
  if (!response.ok) throw new Error(getMessage(data, "删除 MiniMax 语音记录失败"));
  return data;
}

export async function previewAudioVoice(provider, voiceId, { signal, model } = {}) {
  const path = provider === "minimax"
    ? "/api/media/audio/minimax/preview"
    : "/api/media/audio/preview";
  const response = await audioFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...creditOperationHeaders() },
    body: JSON.stringify({ voiceId, model }),
    signal,
  }, "网络连接失败，暂时无法试听");
  if (!response.ok) {
    const data = await readJson(response);
    throw new Error(getMessage(data, "试听失败"));
  }
  notifyCreditFromResponseHeaders(response);
  const blob = await response.blob();
  if (!blob.size) throw new Error("没有返回试听音频");
  if (provider === "minimax") {
    window.dispatchEvent(new CustomEvent("vectaix-minimax-voice-unlocked", {
      detail: { voiceId },
    }));
  }
  return URL.createObjectURL(blob);
}

export async function listMinimaxVoices() {
  const response = await audioFetch("/api/media/audio/minimax/voices", {
    method: "GET",
  }, "网络连接失败，暂时无法读取 MiniMax 音色");
  const data = await readJson(response);
  if (!response.ok) throw new Error(getMessage(data, "读取 MiniMax 音色失败"));
  return {
    systemVoices: Array.isArray(data.systemVoices) ? data.systemVoices : [],
    customVoices: Array.isArray(data.customVoices) ? data.customVoices : [],
  };
}

export async function createMinimaxVoice(input) {
  const response = await audioFetch("/api/media/audio/minimax/voices", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...creditOperationHeaders() },
    body: JSON.stringify(input),
  }, "网络连接失败，暂时无法创建 MiniMax 复刻音色");
  const data = await readJson(response);
  if (!response.ok) throw new Error(getMessage(data, "MiniMax 声音复刻失败"));
  if (!data.voice) throw new Error("声音复刻完成，但没有返回音色记录");
  return data.voice;
}

export async function renameMinimaxVoice(profileId, displayName) {
  const response = await audioFetch(
    `/api/media/audio/minimax/voices/${encodeURIComponent(profileId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName }),
    },
    "网络连接失败，暂时无法修改 MiniMax 音色",
  );
  const data = await readJson(response);
  if (!response.ok) throw new Error(getMessage(data, "修改 MiniMax 音色失败"));
  if (!data.voice) throw new Error("音色修改完成，但没有返回音色记录");
  return data.voice;
}

export async function deleteMinimaxVoice(profileId) {
  const response = await audioFetch(
    `/api/media/audio/minimax/voices/${encodeURIComponent(profileId)}`,
    { method: "DELETE" },
    "网络连接失败，暂时无法删除 MiniMax 音色",
  );
  const data = await readJson(response);
  if (!response.ok) throw new Error(getMessage(data, "删除 MiniMax 音色失败"));
  return data;
}

export async function createDoubaoAudioGeneration(input) {
  const response = await audioFetch("/api/media/audio/doubao/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...creditOperationHeaders() },
    body: JSON.stringify(input),
  }, "网络连接失败，暂时无法生成豆包语音");
  const data = await readJson(response);
  if (!response.ok) throw new Error(getMessage(data, "豆包语音生成失败"));
  if (!data.generation) throw new Error("语音生成完成，但没有返回生成记录");
  return data.generation;
}

export async function listDoubaoAudioGenerations() {
  const response = await audioFetch("/api/media/audio/doubao/generations", {
    method: "GET",
  }, "网络连接失败，暂时无法读取豆包语音记录");
  const data = await readJson(response);
  if (!response.ok) throw new Error(getMessage(data, "读取豆包语音记录失败"));
  return Array.isArray(data.generations) ? data.generations : [];
}

export async function deleteDoubaoAudioGeneration(generationId) {
  const response = await audioFetch(
    `/api/media/audio/doubao/generations/${encodeURIComponent(generationId)}`,
    { method: "DELETE" },
    "网络连接失败，暂时无法删除豆包语音记录",
  );
  const data = await readJson(response);
  if (!response.ok) throw new Error(getMessage(data, "删除豆包语音记录失败"));
  return data;
}

export async function listDoubaoVoices() {
  const response = await audioFetch("/api/media/audio/doubao/voices", {
    method: "GET",
  }, "网络连接失败，暂时无法读取豆包声音");
  const data = await readJson(response);
  if (!response.ok) throw new Error(getMessage(data, "读取豆包声音失败"));
  return Array.isArray(data.voices) ? data.voices : [];
}

export async function createDoubaoVoice(input) {
  const response = await audioFetch("/api/media/audio/doubao/voices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }, "网络连接失败，暂时无法保存豆包声音");
  const data = await readJson(response);
  if (!response.ok) throw new Error(getMessage(data, "保存豆包声音失败"));
  if (!data.voice) throw new Error("声音保存完成，但没有返回声音记录");
  return data.voice;
}

export async function renameDoubaoVoice(profileId, displayName) {
  const response = await audioFetch(
    `/api/media/audio/doubao/voices/${encodeURIComponent(profileId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName }),
    },
    "网络连接失败，暂时无法修改豆包声音名称",
  );
  const data = await readJson(response);
  if (!response.ok) throw new Error(getMessage(data, "修改豆包声音名称失败"));
  if (!data.voice) throw new Error("声音名称修改完成，但没有返回声音记录");
  return data.voice;
}

export async function deleteDoubaoVoice(profileId) {
  const response = await audioFetch(
    `/api/media/audio/doubao/voices/${encodeURIComponent(profileId)}`,
    { method: "DELETE" },
    "网络连接失败，暂时无法删除豆包声音",
  );
  const data = await readJson(response);
  if (!response.ok) throw new Error(getMessage(data, "删除豆包声音失败"));
  return data;
}

export async function createCustomVoice(input) {
  const response = await audioFetch("/api/media/audio/voices", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...creditOperationHeaders() },
    body: JSON.stringify(input),
  }, "网络连接失败，暂时无法创建复刻音色");
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(getMessage(data, "创建复刻音色失败"));
  }
  if (!data.voice) {
    throw new Error("音色创建完成，但没有返回音色信息");
  }
  return data.voice;
}

export async function listCustomVoices() {
  const response = await audioFetch("/api/media/audio/voices", {
    method: "GET",
  }, "网络连接失败，暂时无法读取复刻音色");
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(getMessage(data, "读取复刻音色失败"));
  }
  return Array.isArray(data.voices) ? data.voices : [];
}

export async function getCustomVoice(voiceId) {
  const response = await audioFetch(`/api/media/audio/voices/${encodeURIComponent(voiceId)}`, {
    method: "GET",
  }, "网络连接失败，暂时无法同步音色状态");
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(getMessage(data, "同步音色状态失败"));
  }
  if (!data.voice) {
    throw new Error("没有返回音色信息");
  }
  return data.voice;
}

export async function updateCustomVoice(voiceId, input) {
  const response = await audioFetch(`/api/media/audio/voices/${encodeURIComponent(voiceId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...creditOperationHeaders() },
    body: JSON.stringify(input),
  }, "网络连接失败，暂时无法更新复刻音色");
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(getMessage(data, "更新复刻音色失败"));
  }
  if (!data.voice) {
    throw new Error("音色更新完成，但没有返回音色信息");
  }
  return data.voice;
}

export async function deleteCustomVoice(voiceId) {
  const response = await audioFetch(`/api/media/audio/voices/${encodeURIComponent(voiceId)}`, {
    method: "DELETE",
  }, "网络连接失败，暂时无法删除复刻音色");
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(getMessage(data, "删除复刻音色失败"));
  }
  return data;
}
