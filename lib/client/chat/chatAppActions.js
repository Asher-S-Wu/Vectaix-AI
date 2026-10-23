export function useChatAppActions({ messages, loading, setEditingMsgIndex, setEditingContent, setEditingImages }) {
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

  const onEditingImageRemove = imageId => {
    setEditingImages(current => current.filter(image => image.id !== imageId));
  };

  const copyMessage = async (content) => {
    try {
      await navigator.clipboard.writeText(content);
    } catch { }
  };

  const startEdit = (index, message) => {
    if (loading || hasConversationRunInProgress) return;
    setEditingMsgIndex(index);
    setEditingContent(getPromptTextFromMessage(message));
    const existingImages = (Array.isArray(message?.parts) ? message.parts : [])
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
        fileId: part.inlineData.fileId,
        preview: part.inlineData.url,
      }));
    setEditingImages(existingImages);
  };

  const cancelEdit = () => {
    setEditingMsgIndex(null);
    setEditingContent("");
    setEditingImages([]);
  };

  return { onEditingImageRemove, copyMessage, startEdit, cancelEdit };
}
