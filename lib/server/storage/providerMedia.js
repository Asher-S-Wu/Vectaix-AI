import { findOwnedStoredFile, readStoredFileBuffer } from "@/lib/server/storage/service";

export async function loadOwnedMedia({ userId, fileId, categories = [] }) {
  const file = await findOwnedStoredFile({ userId, fileId });
  if (!file) throw new Error("媒体文件不存在或无权访问");
  if (categories.length > 0 && !categories.includes(file.category)) {
    throw new Error("媒体文件类型不匹配");
  }
  return file;
}

export async function buildPrivateImageDataUrl({ userId, fileId }) {
  const file = await loadOwnedMedia({ userId, fileId, categories: ["image"] });
  const buffer = await readStoredFileBuffer(file);
  return {
    file,
    dataUrl: `data:${file.mimeType};base64,${buffer.toString("base64")}`,
  };
}
