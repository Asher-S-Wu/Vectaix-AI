async function readJson(response) {
  return response.json();
}

export async function generateImage(input) {
  const response = await fetch("/api/media/image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(data.message || "图片生成失败");
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
    throw new Error(data.message || "图片编辑失败");
  }
  if (!data.imageUrl) {
    throw new Error("图片编辑完成，但没有返回结果");
  }
  return String(data.imageUrl);
}

export async function generateVideo(input) {
  const formData = new FormData();
  formData.append("prompt", input.prompt);
  formData.append("aspectRatio", input.aspectRatio);
  formData.append("durationSeconds", String(input.durationSeconds));
  formData.append("resolution", input.resolution);
  formData.append("generateAudio", String(input.generateAudio !== false));
  formData.append("enhancePrompt", String(input.enhancePrompt === true));
  formData.append("personGeneration", input.personGeneration || "");
  if (input.negativePrompt) formData.append("negativePrompt", input.negativePrompt);
  if (input.seed) formData.append("seed", input.seed);
  if (input.fps) formData.append("fps", input.fps);
  if (input.image) formData.append("image", input.image);
  if (input.lastFrame) formData.append("lastFrame", input.lastFrame);

  const response = await fetch("/api/media/video", {
    method: "POST",
    body: formData,
  });
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(data.message || "视频生成失败");
  }
  if (!data.videoUrl) {
    throw new Error("视频生成完成，但没有返回结果");
  }
  return String(data.videoUrl);
}
