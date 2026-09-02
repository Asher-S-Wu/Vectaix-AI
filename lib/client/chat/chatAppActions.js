import { useRef } from "react";
import { deleteTemporaryFile, uploadPrivateFile } from "@/lib/client/uploadFile";
import { buildChatConfig, buildPersistedConversationMessages, runChat, unlockCompletionSound } from "@/lib/client/chat/chatClient";
import { createAttachmentDescriptor } from "@/lib/shared/attachments";
import { isImageAttachment } from "@/lib/shared/messageAttachments";
import {
  isImageGenerationModel,
  isMediaGenerationModel,
} from "@/lib/shared/models";
import { IMAGE_EDIT_MAX_COUNT } from "@/lib/media/shared/models";

let msgIdCounter = 0;
const generateMsgId = () => `msg_${Date.now()}_${++msgIdCounter}`;

export function useChatAppActions({
  toast,
  messages,
  setMessages,
  loading,
  setLoading,
  model,
  webSearch,
  chatSystemPrompt,
  currentConversationId,
  setCurrentConversationId,
  fetchConversations,
  chatAbortRef,
  chatRequestLockRef,
  userInterruptedRef,
  editingMsgIndex,
  editingContent,
  editingImages,
  setEditingMsgIndex,
  setEditingContent,
  setEditingImages,
  completionSoundVolume,
  onSensitiveRefusal,
  onAuthExpired,
  onConversationMissing,
  onConversationActivity,
}) {
  const activeEditingUploadIdsRef = useRef(new Set());
  const completedEditingUploadFileIdsRef = useRef(new Map());
  const hasConversationRunInProgress = Array.isArray(messages) && messages.some((message) => message?.isStreaming === true);

  const buildRuntimeConfig = ({ images = [], attachments = [], mediaOptions } = {}) => {
    const resolvedChatSystemPrompt = typeof chatSystemPrompt === "string" && chatSystemPrompt.trim()
      ? chatSystemPrompt
      : "";
    return buildChatConfig({
      images,
      attachments,
      mediaOptions,
      webSearch,
      systemPromptSuffix: resolvedChatSystemPrompt,
    });
  };

  const stopStreaming = async () => {
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    chatRequestLockRef.current = false;
    setLoading(false);
  };

  const buildPendingModelMessage = (messageId) => {
    const pendingText = "正在处理中…";
    return {
      id: messageId,
      role: "model",
      content: pendingText,
      type: "text",
      parts: [{ text: pendingText }],
      isStreaming: true,
      isWaitingFirstChunk: true,
      isThinkingStreaming: true,
    };
  };

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

  const syncConversationMessages = async (nextMessages) => {
    if (!currentConversationId) return;
    try {
      const persistedMessages = buildPersistedConversationMessages(nextMessages);
      await fetch(`/api/conversations/${currentConversationId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: persistedMessages }),
        }
      );
    } catch { }
  };

  const deleteModelMessage = async (index) => {
    const nextMessages = messages.filter((_, i) => i !== index);
    setMessages(nextMessages);
    await syncConversationMessages(nextMessages);
  };

  const deleteUserMessage = async (index) => {
    const nextMessages = messages.filter(
      (_, i) => i !== index && i !== index + 1,
    );
    setMessages(nextMessages);
    await syncConversationMessages(nextMessages);
  };

  const handleSendFromComposer = async ({ text, attachments, mediaOptions }) => {
    if ((!text && (!attachments || attachments.length === 0)) || loading || chatRequestLockRef.current) return;
    chatRequestLockRef.current = true;

    if (currentConversationId) {
      onConversationActivity?.(currentConversationId);
    }

    unlockCompletionSound();
    userInterruptedRef.current = false;

    const uploadedImages = [];
    const displayImages = [];
    const uploadedFiles = [];
    if (Array.isArray(attachments) && attachments.length > 0) {
      for (const attachment of attachments) {
        const fileName = attachment?.name || attachment?.file?.name || "文件";
        const fileId = typeof attachment?.fileId === "string" ? attachment.fileId : "";
        const fileUrl = typeof attachment?.fileUrl === "string" ? attachment.fileUrl : "";

        if (!fileId || !fileUrl) {
          toast.error(`「${fileName}」还没上传完成，已跳过`);
          continue;
        }

        if (isImageAttachment(attachment)) {
          const mimeType = attachment?.file?.type || attachment?.mimeType;
          if (typeof mimeType === "string" && mimeType) {
            uploadedImages.push({ fileId, url: fileUrl, mimeType });
            const previewUrl = typeof attachment?.preview === "string" ? attachment.preview : "";
            displayImages.push({
              fileId,
              url: fileUrl,
              mimeType,
              ...(previewUrl && previewUrl !== fileUrl ? { localPreviewUrl: previewUrl } : {}),
            });
          }
          continue;
        }

        uploadedFiles.push({
          ...createAttachmentDescriptor({
          url: fileUrl,
          name: attachment.name,
          mimeType: attachment.mimeType,
          size: attachment.size,
          extension: attachment.extension,
          category: attachment.category,
          }),
          fileId,
        });
      }
    }

    const userMsgParts = [];
    if (typeof text === "string" && text) {
      userMsgParts.push({ text });
    }
    for (const image of displayImages) {
      if (image?.url && image?.mimeType) {
        userMsgParts.push({
          inlineData: {
            fileId: image.fileId,
            url: image.url,
            mimeType: image.mimeType,
            ...(image.localPreviewUrl ? { localPreviewUrl: image.localPreviewUrl } : {}),
          },
        });
      }
    }
    for (const file of uploadedFiles) {
      if (file?.fileId && file?.url && file?.name && file?.mimeType && file?.extension && file?.category) {
        userMsgParts.push({ fileData: file });
      }
    }

    if (userMsgParts.length === 0) {
      setLoading(false);
      chatRequestLockRef.current = false;
      return;
    }

    const userMsg = {
      id: generateMsgId(),
      role: "user",
      content: text,
      type: "parts",
      parts: userMsgParts,
      ...(isMediaGenerationModel(model) ? { providerState: { media: mediaOptions || {} } } : {}),
    };
    const pendingModelMessage = buildPendingModelMessage(generateMsgId());

    const historyBeforeUser = messages;
    setMessages((prev) => [...prev, userMsg, pendingModelMessage]);

    setLoading(true);
    try {
      const config = buildRuntimeConfig({ images: uploadedImages, attachments: uploadedFiles, mediaOptions });
      await runChat({
        prompt: text,
        historyMessages: historyBeforeUser,
        conversationId: currentConversationId,
        model,
        config,
        currentConversationId,
        setCurrentConversationId,
        fetchConversations,
        setMessages,
        setLoading,
        signal: (chatAbortRef.current = new AbortController()).signal,
        settings: !currentConversationId ? {
          webSearch,
        } : undefined,
        completionSoundVolume,
        onSensitiveRefusal,
        onUnauthorized: onAuthExpired,
        onConversationMissing,
        onError: (msg) => toast.error(msg),
        userMessageId: userMsg.id,
        targetMessageId: pendingModelMessage.id,
      });
    } catch (err) {
      const errMsg = err?.message;
      const friendlyMsg = errMsg?.includes("Failed to fetch")
        ? "网络连接失败，请检查网络后重试"
        : `发送失败：${errMsg || "未知错误"}`;
      if (err?.status === 401) {
        onAuthExpired?.();
      }
      setMessages((prev) => prev.filter((msg) => msg?.id !== userMsg.id && msg?.id !== pendingModelMessage.id));
      toast.error(friendlyMsg);
    } finally {
      setLoading(false);
      chatRequestLockRef.current = false;
    }
  };

  const regenerateModelMessage = async (index) => {
    if (loading || hasConversationRunInProgress || chatRequestLockRef.current) return;

    const modelMsg = messages[index];
    const userMsg = messages[index - 1];
    if (modelMsg?.role !== "model" || userMsg?.role !== "user") {
      toast.error("没有找到可重新生成的消息");
      return;
    }

    const promptText = getPromptTextFromMessage(userMsg);
    const hasUserParts = Array.isArray(userMsg?.parts) && userMsg.parts.some((part) => (
      typeof part?.text === "string" && part.text.trim()
    ) || part?.inlineData?.url || part?.fileData?.url);
    if (!promptText && !hasUserParts) {
      toast.error("没有找到可重新生成的内容");
      return;
    }

    chatRequestLockRef.current = true;
    unlockCompletionSound();
    userInterruptedRef.current = false;

    const messagesBeforeRegenerate = messages.slice();
    const nextMessages = messages.slice(0, index);
    setMessages(nextMessages);

    try {
      await runChat({
        prompt: promptText,
        historyMessages: nextMessages.slice(0, -1),
        conversationId: currentConversationId,
        model,
        config: buildRuntimeConfig({ mediaOptions: userMsg?.providerState?.media }),
        currentConversationId,
        setCurrentConversationId,
        fetchConversations,
        setMessages,
        setLoading,
        signal: (chatAbortRef.current = new AbortController()).signal,
        mode: "regenerate",
        messagesForRegenerate: nextMessages,
        completionSoundVolume,
        refusalRestoreMessages: messagesBeforeRegenerate,
        onSensitiveRefusal,
        onUnauthorized: onAuthExpired,
        onConversationMissing,
        onError: (msg) => toast.error(msg),
      });
    } finally {
      chatRequestLockRef.current = false;
    }
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

  const submitEditAndRegenerate = async (index) => {
    if (loading || hasConversationRunInProgress || editingMsgIndex === null || chatRequestLockRef.current) return;
    chatRequestLockRef.current = true;
    unlockCompletionSound();
    const newContent = editingContent.trim();
    if (isImageGenerationModel(model) && !newContent) {
      chatRequestLockRef.current = false;
      toast.warning("请输入图片描述");
      return;
    }
    if (editingImages.some((image) => image?.uploadStatus === "uploading")) {
      chatRequestLockRef.current = false;
      toast.warning("参考图片还在上传，请稍等上传完成后再提交");
      return;
    }
    const failedImage = editingImages.find((image) => image?.uploadStatus === "error");
    if (failedImage) {
      chatRequestLockRef.current = false;
      toast.error(`图片上传失败：${failedImage.errorMessage || "未知错误"}`);
      return;
    }
    const oldMsg = messages[index];
    const messagesBeforeEdit = messages.slice();
    const existingFileParts = Array.isArray(oldMsg?.parts)
      ? oldMsg.parts.filter((p) => p?.fileData?.fileId && p?.fileData?.url && p?.fileData?.name)
      : [];
    const hasImageAfterEdit = editingImages.length > 0;
    const hasFileAfterEdit = existingFileParts.length > 0;
    if (!newContent && !hasImageAfterEdit && !hasFileAfterEdit) {
      chatRequestLockRef.current = false;
      return;
    }

    userInterruptedRef.current = false;
    setLoading(true);

    const nextMessages = messages.slice(0, index);
    const updatedMsg = { ...oldMsg, content: newContent };

    const nextImageParts = [];
    try {
      for (const image of editingImages) {
        const fileId = typeof image?.fileId === "string" ? image.fileId : "";
        const fileUrl = typeof image?.fileUrl === "string" ? image.fileUrl : "";
        const mimeType = typeof image?.mimeType === "string" ? image.mimeType : "";
        if (!fileId || !fileUrl || !mimeType) throw new Error("图片还没上传完成");
        const previewUrl = typeof image?.preview === "string" ? image.preview : "";
        nextImageParts.push({
          inlineData: {
            fileId,
            url: fileUrl,
            mimeType,
            ...(previewUrl && previewUrl !== fileUrl ? { localPreviewUrl: previewUrl } : {}),
          },
        });
      }

      const parts = [];
      if (newContent) parts.push({ text: newContent });
      for (const part of nextImageParts) {
        if (part?.inlineData?.fileId && part?.inlineData?.url && part?.inlineData?.mimeType) {
          parts.push({
            inlineData: {
              fileId: part.inlineData.fileId,
              url: part.inlineData.url,
              mimeType: part.inlineData.mimeType,
              ...(part.inlineData.localPreviewUrl ? { localPreviewUrl: part.inlineData.localPreviewUrl } : {}),
            },
          });
        }
      }
      for (const part of existingFileParts) {
        if (part?.fileData?.fileId && part?.fileData?.url && part?.fileData?.name) {
          parts.push({
            fileData: {
              fileId: part.fileData.fileId,
              url: part.fileData.url,
              name: part.fileData.name,
              mimeType: part.fileData.mimeType,
              size: Number(part.fileData.size) || 0,
              extension: part.fileData.extension,
              category: part.fileData.category,
            },
          });
        }
      }

      if (parts.length > 0) updatedMsg.parts = parts;
      else delete updatedMsg.parts;
    } catch (e) {
      chatRequestLockRef.current = false;
      setLoading(false);
      const errMsg = e?.message || "未知错误";
      const friendlyMsg = errMsg.includes("Failed to fetch") ? "网络连接失败，请检查网络后重试" : `图片上传失败：${errMsg}`;
      toast.error(friendlyMsg);
      return;
    }

    nextMessages.push(updatedMsg);
    setMessages(nextMessages);
    cancelEdit({ preserveUploaded: true });

    try {
      await runChat({
        prompt: newContent,
        historyMessages: nextMessages.slice(0, -1),
        conversationId: currentConversationId,
        model,
        config: buildRuntimeConfig({ mediaOptions: updatedMsg?.providerState?.media }),
        currentConversationId,
        setCurrentConversationId,
        fetchConversations,
        setMessages,
        setLoading,
        signal: (chatAbortRef.current = new AbortController()).signal,
        mode: "regenerate",
        messagesForRegenerate: nextMessages,
        completionSoundVolume,
        refusalRestoreMessages: messagesBeforeEdit,
        onSensitiveRefusal,
        onUnauthorized: onAuthExpired,
        onConversationMissing,
        onError: (msg) => toast.error(msg),
      });
    } finally {
      chatRequestLockRef.current = false;
    }
  };

  return {
    stopStreaming,
    onEditingImagesSelect,
    onEditingImageRemove,
    copyMessage,
    deleteModelMessage,
    deleteUserMessage,
    handleSendFromComposer,
    regenerateModelMessage,
    startEdit,
    cancelEdit,
    submitEditAndRegenerate,
  };
}
