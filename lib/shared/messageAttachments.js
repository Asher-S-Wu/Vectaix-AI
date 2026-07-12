import {
  createAttachmentDescriptor,
  formatFileSize,
  getAttachmentCategory,
  getFileExtension,
  isImageMimeType,
  normalizeMimeType,
} from "@/lib/shared/attachments";

export function isImageAttachment(attachment) {
  if (!attachment || typeof attachment !== "object") return false;
  const mimeType = attachment.mimeType || attachment.file?.type || attachment.fileData?.mimeType;
  const extension = attachment.extension || attachment.fileData?.extension || getFileExtension(attachment.name || attachment.file?.name || attachment.fileData?.name);
  return getAttachmentCategory({ extension, mimeType }) === "image" || isImageMimeType(mimeType);
}

export function createLocalAttachment({
  file,
  preview = null,
}) {
  const extension = getFileExtension(file?.name);
  const mimeType = normalizeMimeType(file?.type);
  const category = getAttachmentCategory({ extension, mimeType });
  return {
    id: `${Date.now()}-${Math.random()}`,
    file,
    preview,
    name: file?.name || "file",
    size: Number(file?.size) || 0,
    mimeType,
    extension,
    category,
  };
}

export function getMessageFileAttachments(msg) {
  if (!Array.isArray(msg?.parts)) return [];
  return msg.parts
    .filter((part) => part?.fileData && typeof part.fileData === "object")
    .map((part) => ({ ...part.fileData, ...createAttachmentDescriptor(part.fileData) }))
    .filter((item) => item.url && item.name);
}

export function getMessageImageParts(msg) {
  if (!Array.isArray(msg?.parts)) return [];
  return msg.parts
    .filter((part) => part?.inlineData?.url && part?.inlineData?.mimeType)
    .map((part) => ({
      fileId: part.inlineData.fileId,
      url: part.inlineData.url,
      mimeType: part.inlineData.mimeType,
    }));
}

export function formatAttachmentMeta(file) {
  if (!file) return "";
  const extension = file.extension ? file.extension.toUpperCase() : "";
  const sizeText = formatFileSize(file.size);
  return [extension, sizeText].filter(Boolean).join(" · ");
}
