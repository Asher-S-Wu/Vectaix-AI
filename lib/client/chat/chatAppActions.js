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
    await navigator.clipboard.writeText(content);
  };

  const startEdit = (index, message) => {
    if (loading || hasConversationRunInProgress) return;
    setEditingMsgIndex(index);
    setEditingContent(getPromptTextFromMessage(message));
    const existingAttachments = (Array.isArray(message?.parts) ? message.parts : [])
      .filter(part => part?.inlineData?.fileId || part?.fileData?.fileId)
      .map((part, index) => {
        const file = part.inlineData || part.fileData;
        return { id: `existing-${file.fileId}-${index}`, fileId: file.fileId, preview: part.inlineData?.url, file: part.fileData };
      });
    setEditingImages(existingAttachments);
  };

  const cancelEdit = () => {
    setEditingMsgIndex(null);
    setEditingContent("");
    setEditingImages([]);
  };

  return { onEditingImageRemove, copyMessage, startEdit, cancelEdit };
}
