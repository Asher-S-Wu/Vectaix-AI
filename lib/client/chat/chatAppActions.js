import { deleteTemporaryFile, uploadPrivateFile } from "@/lib/client/uploadFile";
import { buildChatConfig, buildPersistedConversationMessages, runChat, unlockCompletionSound } from "@/lib/client/chat/chatClient";
import { createAttachmentDescriptor } from "@/lib/shared/attachments";
import { isImageAttachment } from "@/lib/shared/messageAttachments";
import {
  getDefaultThinkingLevel,
} from "@/lib/shared/models";

let msgIdCounter = 0;
const generateMsgId = () => `msg_${Date.now()}_${++msgIdCounter}`;

export function useChatAppActions({
  toast,
  messages,
  setMessages,
  loading,
  setLoading,
  model,
  thinkingLevels,
  mediaResolution,
  maxTokens,
  webSearch,
  chatSystemPrompt,
  historyLimit,
  currentConversationId,
  setCurrentConversationId,
  fetchConversations,
  chatAbortRef,
  chatRequestLockRef,
  userInterruptedRef,
  editingMsgIndex,
  editingContent,
  editingImageAction,
  editingImage,
  setEditingMsgIndex,
  setEditingContent,
  setEditingImageAction,
  setEditingImage,
  completionSoundVolume,
  onSensitiveRefusal,
  onAuthExpired,
  onConversationMissing,
  onConversationActivity,
}) {
  const canEditUserMessage = true;
  const hasConversationRunInProgress = Array.isArray(messages) && messages.some((message) => message?.isStreaming === true);

  const getEffectiveThinkingLevel = (m) => {
    const v = thinkingLevels?.[m];
    if (typeof v === "string" && v) return v;
    return getDefaultThinkingLevel(m);
  };

  const buildRuntimeConfig = ({ images = [], attachments = [] } = {}) => {
    const resolvedChatSystemPrompt = typeof chatSystemPrompt === "string" && chatSystemPrompt.trim()
      ? chatSystemPrompt
      : "";
    return buildChatConfig({
      modelId: model,
      thinkingLevel: getEffectiveThinkingLevel(model),
      mediaResolution,
      images,
      attachments,
      maxTokens,
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

  const buildHistoryPayload = (historyMessages) => {
    if (!Array.isArray(historyMessages)) return [];
    return historyMessages
      .map((message) => ({
        role: message?.role,
        content: typeof message?.content === "string" ? message.content : "",
        parts: Array.isArray(message?.parts)
          ? message.parts
            .filter((part) => part && typeof part === "object")
            .map((part) => {
              const nextPart = {};
              if (typeof part.text === "string" && part.text) nextPart.text = part.text;
              if (part.inlineData && typeof part.inlineData === "object") nextPart.inlineData = part.inlineData;
              if (part.fileData && typeof part.fileData === "object") nextPart.fileData = part.fileData;
              return nextPart;
            })
            .filter((part) => Object.keys(part).length > 0)
          : [],
      }))
      .filter((message) => message.role === "user" || message.role === "model");
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

  const onEditingImageSelect = (img) => {
    if (editingImage?.fileId) deleteTemporaryFile(editingImage.fileId);
    const uploadId = `edit-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setEditingImageAction("new");
    setEditingImage({
      ...img,
      uploadId,
      uploadStatus: "uploading",
      fileId: null,
      fileUrl: null,
      errorMessage: "",
    });

    uploadPrivateFile(img.file, { kind: "chat", model }).then((uploaded) => {
      setEditingImage((prev) => (
        prev?.uploadId === uploadId
          ? { ...prev, uploadStatus: "ready", fileId: uploaded.fileId, fileUrl: uploaded.url, errorMessage: "" }
          : prev
      ));
    }).catch((error) => {
      setEditingImage((prev) => (
        prev?.uploadId === uploadId
          ? { ...prev, uploadStatus: "error", fileId: null, fileUrl: null, errorMessage: error?.message || "未知错误" }
          : prev
      ));
      toast.error(`图片上传失败：${error?.message || "未知错误"}`);
    });
  };

  const onEditingImageRemove = () => {
    if (editingImage?.fileId) deleteTemporaryFile(editingImage.fileId);
    setEditingImageAction("remove");
    setEditingImage(null);
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

  const handleSendFromComposer = async ({ text, attachments }) => {
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
    };
    const pendingModelMessage = buildPendingModelMessage(generateMsgId());

    const historyBeforeUser = messages;
    setMessages((prev) => [...prev, userMsg, pendingModelMessage]);

    setLoading(true);
    try {
      const config = buildRuntimeConfig({ images: uploadedImages, attachments: uploadedFiles });
      await runChat({
        prompt: text,
        historyMessages: historyBeforeUser,
        conversationId: currentConversationId,
        model,
        config,
        historyLimit,
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
        config: buildRuntimeConfig(),
        historyLimit,
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
    if (!canEditUserMessage) {
      toast.error("当前模型不支持编辑并重新生成");
      return;
    }
    if (loading || hasConversationRunInProgress) return;
    setEditingMsgIndex(index);
    setEditingContent(getPromptTextFromMessage(msg));
    setEditingImageAction("keep");
    setEditingImage(null);
  };

  const cancelEdit = ({ preserveUploaded = false } = {}) => {
    if (!preserveUploaded && editingImage?.fileId) deleteTemporaryFile(editingImage.fileId);
    setEditingMsgIndex(null);
    setEditingContent("");
    setEditingImageAction("keep");
    setEditingImage(null);
  };

  const submitEditAndRegenerate = async (index) => {
    if (!canEditUserMessage) {
      toast.error("当前模型不支持编辑并重新生成");
      return;
    }
    if (loading || hasConversationRunInProgress || editingMsgIndex === null || chatRequestLockRef.current) return;
    chatRequestLockRef.current = true;
    unlockCompletionSound();
    const newContent = editingContent.trim();
    if (editingImageAction === "new" && editingImage?.uploadStatus === "uploading") {
      chatRequestLockRef.current = false;
      toast.warning("图片还在上传，请稍等上传完成后再提交");
      return;
    }
    if (editingImageAction === "new" && editingImage?.uploadStatus === "error") {
      chatRequestLockRef.current = false;
      toast.error(`图片上传失败：${editingImage?.errorMessage || "未知错误"}`);
      return;
    }
    const oldMsg = messages[index];
    const messagesBeforeEdit = messages.slice();
    const existingImageParts = Array.isArray(oldMsg?.parts)
      ? oldMsg.parts.filter((p) => p?.inlineData?.fileId && p?.inlineData?.url)
      : [];
    const existingFileParts = Array.isArray(oldMsg?.parts)
      ? oldMsg.parts.filter((p) => p?.fileData?.fileId && p?.fileData?.url && p?.fileData?.name)
      : [];
    const canKeepExistingImages = existingImageParts.length > 0 && existingImageParts.every((p) => {
      const url = p?.inlineData?.url;
      const mimeType = p?.inlineData?.mimeType;
      return Boolean(p?.inlineData?.fileId && url && typeof mimeType === "string" && mimeType);
    });
    const hasImageAfterEdit =
      (editingImageAction === "new" && editingImage?.file) ||
      (editingImageAction === "keep" && canKeepExistingImages);
    const hasFileAfterEdit = existingFileParts.length > 0;
    if (!newContent && !hasImageAfterEdit && !hasFileAfterEdit) {
      chatRequestLockRef.current = false;
      return;
    }

    userInterruptedRef.current = false;
    setLoading(true);

    const nextMessages = messages.slice(0, index);
    const updatedMsg = { ...oldMsg, content: newContent };

    let nextImageParts = [];
    try {
      if (editingImageAction === "remove") {
        nextImageParts = [];
      } else if (editingImageAction === "new" && editingImage?.file) {
        const fileId = typeof editingImage?.fileId === "string" ? editingImage.fileId : "";
        const fileUrl = typeof editingImage?.fileUrl === "string" ? editingImage.fileUrl : "";
        const mimeType = typeof editingImage.mimeType === "string" ? editingImage.mimeType : "";
        if (!fileId || !fileUrl || !mimeType) throw new Error("图片还没上传完成");
        const previewUrl = typeof editingImage.preview === "string" ? editingImage.preview : "";
        nextImageParts = [{
          inlineData: {
            fileId,
            url: fileUrl,
            mimeType,
            ...(previewUrl && previewUrl !== fileUrl ? { localPreviewUrl: previewUrl } : {}),
          },
        }];
      } else if (editingImageAction === "keep") {
        for (const p of existingImageParts) {
          const src = p?.inlineData?.url;
          const mimeType = typeof p?.inlineData?.mimeType === "string" ? p.inlineData.mimeType : "";
          if (!src || !mimeType) continue;

          const fileId = p?.inlineData?.fileId;
          if (fileId) nextImageParts.push({ inlineData: { fileId, url: src, mimeType } });
        }
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
        config: buildRuntimeConfig(),
        historyLimit,
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
    onEditingImageSelect,
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
