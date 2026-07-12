export async function uploadPrivateFile(file, { kind, model = "" } = {}) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("kind", kind || "chat");
  if (model) formData.append("model", model);

  const response = await fetch("/api/upload", {
    method: "POST",
    body: formData,
    credentials: "same-origin",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || "文件上传失败");
  }
  return payload;
}

export async function deleteTemporaryFile(fileId) {
  if (!fileId) return false;
  const response = await fetch(`/api/files/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  return response.ok;
}
