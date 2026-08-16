async function readJson(response) {
  try {
    return await response.json();
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
    headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
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

export async function createDoubaoAudioGeneration(input) {
  const response = await audioFetch("/api/media/audio/doubao/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }, "网络连接失败，暂时无法生成 Doubao 音频");
  const data = await readJson(response);
  if (!response.ok) throw new Error(getMessage(data, "Doubao 音频生成失败"));
  if (!data.generation) throw new Error("音频生成完成，但没有返回生成记录");
  return data.generation;
}

export async function listDoubaoAudioGenerations() {
  const response = await audioFetch("/api/media/audio/doubao/generations", {
    method: "GET",
  }, "网络连接失败，暂时无法读取 Doubao 音频记录");
  const data = await readJson(response);
  if (!response.ok) throw new Error(getMessage(data, "读取 Doubao 音频记录失败"));
  return Array.isArray(data.generations) ? data.generations : [];
}

export async function getDoubaoAudioGeneration(generationId) {
  const response = await audioFetch(
    `/api/media/audio/doubao/generations/${encodeURIComponent(generationId)}`,
    { method: "GET" },
    "网络连接失败，暂时无法读取字幕",
  );
  const data = await readJson(response);
  if (!response.ok) throw new Error(getMessage(data, "读取字幕失败"));
  if (!data.generation) throw new Error("没有返回音频记录");
  return data.generation;
}

export async function deleteDoubaoAudioGeneration(generationId) {
  const response = await audioFetch(
    `/api/media/audio/doubao/generations/${encodeURIComponent(generationId)}`,
    { method: "DELETE" },
    "网络连接失败，暂时无法删除 Doubao 音频记录",
  );
  const data = await readJson(response);
  if (!response.ok) throw new Error(getMessage(data, "删除 Doubao 音频记录失败"));
  return data;
}

export async function createCustomVoice(input) {
  const response = await audioFetch("/api/media/audio/voices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
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
