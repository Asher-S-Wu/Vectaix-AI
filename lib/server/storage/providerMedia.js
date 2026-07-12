import { getStoredFileAbsolutePath, findOwnedStoredFile, readStoredFileBuffer } from "@/lib/server/storage/service";

const GEMINI_FILE_LIFETIME_MS = 47 * 60 * 60 * 1000;
const GEMINI_EXPIRY_SAFETY_MS = 5 * 60 * 1000;

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

function parseGeminiExpiry(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function ensureGeminiMediaFile(client, file) {
  const currentUri = typeof file?.geminiFile?.uri === "string" ? file.geminiFile.uri : "";
  const currentExpiry = parseGeminiExpiry(file?.geminiFile?.expiresAt);
  if (currentUri && currentExpiry && currentExpiry.getTime() > Date.now() + GEMINI_EXPIRY_SAFETY_MS) {
    return {
      uri: currentUri,
      mimeType: file.geminiFile.mimeType || file.mimeType,
    };
  }

  const uploaded = await client.files.upload({
    file: getStoredFileAbsolutePath(file),
    config: {
      mimeType: file.mimeType,
      displayName: file.originalName,
    },
  });
  const uri = typeof uploaded?.uri === "string" ? uploaded.uri : "";
  if (!uri) throw new Error("Gemini 文件上传失败");
  const expiresAt = parseGeminiExpiry(uploaded.expirationTime)
    || new Date(Date.now() + GEMINI_FILE_LIFETIME_MS);
  file.geminiFile = {
    uri,
    mimeType: uploaded.mimeType || file.mimeType,
    expiresAt,
  };
  await file.save();
  return { uri, mimeType: file.geminiFile.mimeType };
}
