import { useRef } from "react";
import { deleteTemporaryFile, uploadPrivateFile } from "@/lib/client/uploadFile";
import { isImageGenerationModel } from "@/lib/shared/models";
import { IMAGE_EDIT_MAX_COUNT } from "@/lib/media/shared/models";

export function useChatAppActions({ toast, messages, loading, model, editingImages, setEditingMsgIndex, setEditingContent, setEditingImages }) {
  const activeEditingUploadIdsRef = useRef(new Set());
  const completedEditingUploadFileIdsRef = useRef(new Map());
  const hasConversationRunInProgress = messages.some(message => message?.isStreaming);
  const getPromptTextFromMessage = (message) => {
    if (typeof message?.content === "string" && message.content.trim()) {
      return message.content.trim();
    }

    if (Array.isArray(message?.parts)) {
      return message.parts
        .map((part) => (typeof part?.text === "string" ? part.text.trim() : ""))
        .filter(Boolean)
        .join("\n\n")
        .trim();
    }

    return "";
  };

  const onEditingImagesSelect = (selectedImages) => {
    const items = Array.isArray(selectedImages) ? selectedImages : [];
    if (items.length === 0) return;
    const imageLimit = isImageGenerationModel(model) ? IMAGE_EDIT_MAX_COUNT : 1;
    const baseImages = isImageGenerationModel(model) ? editingImages : [];

    if (!isImageGenerationModel(model)) {
      for (const image of editingImages) {
        activeEditingUploadIdsRef.current.delete(image?.id);
        const uploadedFileId = image?.fileId || completedEditingUploadFileIdsRef.current.get(image?.id);
        if (image?.source === "new" && uploadedFileId) deleteTemporaryFile(uploadedFileId);
        completedEditingUploadFileIdsRef.current.delete(image?.id);
      }
    }

    const pendingImages = items
      .slice(0, Math.max(0, imageLimit - baseImages.length))
      .map((image) => ({
        ...image,
        id: `edit-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        source: "new",
        uploadStatus: "uploading",
        fileId: null,
        fileUrl: null,
        errorMessage: "",
      }));
    if (pendingImages.length === 0) return;
    for (const image of pendingImages) activeEditingUploadIdsRef.current.add(image.id);
    setEditingImages([...baseImages, ...pendingImages]);

    for (const image of pendingImages) {
      uploadPrivateFile(image.file, { kind: "chat", model }).then((uploaded) => {
        if (!activeEditingUploadIdsRef.current.delete(image.id)) {
          deleteTemporaryFile(uploaded.fileId);
          return;
        }
        completedEditingUploadFileIdsRef.current.set(image.id, uploaded.fileId);
        setEditingImages((current) => current.map((item) => (
          item.id === image.id
            ? {
                ...item,
                uploadStatus: "ready",
                fileId: uploaded.fileId,
                fileUrl: uploaded.url,
                mimeType: uploaded.mimeType || item.mimeType,
                errorMessage: "",
              }
            : item
        )));
      }).catch((error) => {
        if (!activeEditingUploadIdsRef.current.delete(image.id)) return;
        setEditingImages((current) => current.map((item) => (
          item.id === image.id
            ? {
                ...item,
                uploadStatus: "error",
                fileId: null,
                fileUrl: null,
                errorMessage: error?.message || "未知错误",
              }
            : item
        )));
        toast.error(`图片上传失败：${error?.message || "未知错误"}`);
      });
    }
  };

  const onEditingImageRemove = (imageId) => {
    const target = editingImages.find((image) => image?.id === imageId);
    activeEditingUploadIdsRef.current.delete(imageId);
    const uploadedFileId = target?.fileId || completedEditingUploadFileIdsRef.current.get(imageId);
    if (target?.source === "new" && uploadedFileId) deleteTemporaryFile(uploadedFileId);
    completedEditingUploadFileIdsRef.current.delete(imageId);
    setEditingImages((current) => current.filter((image) => image?.id !== imageId));
  };

  const copyMessage = async (content) => {
    try {
      await navigator.clipboard.writeText(content);
    } catch { }
  };

  const startEdit = (index, msg) => {
    if (loading || hasConversationRunInProgress) return;
    for (const image of editingImages) {
      activeEditingUploadIdsRef.current.delete(image?.id);
      const uploadedFileId = image?.fileId || completedEditingUploadFileIdsRef.current.get(image?.id);
      if (image?.source === "new" && uploadedFileId) deleteTemporaryFile(uploadedFileId);
      completedEditingUploadFileIdsRef.current.delete(image?.id);
    }
    setEditingMsgIndex(index);
    setEditingContent(getPromptTextFromMessage(msg));
    const existingImages = (Array.isArray(msg?.parts) ? msg.parts : [])
      .filter((part) => (
        typeof part?.inlineData?.fileId === "string"
        && part.inlineData.fileId
        && typeof part?.inlineData?.url === "string"
        && part.inlineData.url
        && typeof part?.inlineData?.mimeType === "string"
        && part.inlineData.mimeType
      ))
      .map((part, imageIndex) => ({
        id: `existing-${part.inlineData.fileId}-${imageIndex}`,
        source: "existing",
        fileId: part.inlineData.fileId,
        fileUrl: part.inlineData.url,
        mimeType: part.inlineData.mimeType,
        preview: part.inlineData.url,
        name: `参考图片 ${imageIndex + 1}`,
        uploadStatus: "ready",
      }));
    setEditingImages(existingImages);
  };

  const cancelEdit = ({ preserveUploaded = false } = {}) => {
    if (!preserveUploaded) {
      for (const image of editingImages) {
        activeEditingUploadIdsRef.current.delete(image?.id);
        const uploadedFileId = image?.fileId || completedEditingUploadFileIdsRef.current.get(image?.id);
        if (image?.source === "new" && uploadedFileId) deleteTemporaryFile(uploadedFileId);
        completedEditingUploadFileIdsRef.current.delete(image?.id);
      }
    } else {
      for (const image of editingImages) {
        completedEditingUploadFileIdsRef.current.delete(image?.id);
      }
    }
    setEditingMsgIndex(null);
    setEditingContent("");
    setEditingImages([]);
  };

  return { onEditingImagesSelect, onEditingImageRemove, copyMessage, startEdit, cancelEdit };
}
