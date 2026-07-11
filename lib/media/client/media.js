async function readJson(response) {
  return response.json();
}

function getMessage(data, fallback) {
  return data?.message || data?.error || fallback;
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

export async function editImage(input) {
  const formData = new FormData();
  formData.append("prompt", input.prompt);
  formData.append("size", input.size);
  formData.append("image", input.image);

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

function buildVideoTaskFormData(input) {
  const formData = new FormData();
  formData.append("prompt", input.prompt || "");
  formData.append("ratio", input.ratio || "adaptive");
  formData.append("duration", String(input.duration ?? 5));
  formData.append("resolution", input.resolution || "720p");
  formData.append("generateAudio", String(input.generateAudio !== false));
  formData.append("watermark", String(input.watermark === true));
  if (input.image) formData.append("image", input.image);
  return formData;
}

export async function createVideoTask(input) {
  const response = await fetch("/api/media/video/tasks", {
    method: "POST",
    body: buildVideoTaskFormData(input),
  });
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
  const response = await fetch("/api/media/video/tasks", {
    method: "GET",
  });
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(getMessage(data, "读取视频任务失败"));
  }
  return Array.isArray(data.tasks) ? data.tasks : [];
}

export async function getVideoTask(taskId) {
  const response = await fetch(`/api/media/video/tasks/${encodeURIComponent(taskId)}`, {
    method: "GET",
  });
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
  const response = await fetch(`/api/media/video/tasks/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
  });
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(getMessage(data, "处理视频任务失败"));
  }
  return data;
}
