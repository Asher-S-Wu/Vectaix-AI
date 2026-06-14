"use client";

import {
  CHAT_RUNTIME_MODE_CHAT,
  DEFAULT_MODEL,
  getModelConfig,
  isPrimaryChatModelId,
} from "@/lib/shared/models";

export function useChatModeController({
  loading,
  messages,
  model,
  setModel,
  setChatMode,
  currentConversationId,
  setCurrentConversationId,
  setMessages,
  setSidebarOpen,
  setConfirmModalConfig,
  setShowConfirmModal,
  stopOngoingChatWork,
  persistConversationModel,
  userInterruptedRef,
  lastTextModelRef,
}) {
  const hasStreamingMessage = () => messages.some((message) => message?.isStreaming);

  const resetConversation = () => {
    userInterruptedRef.current = false;
    setCurrentConversationId(null);
    setMessages([]);
  };

  const startNewChat = async () => {
    resetConversation();
    stopOngoingChatWork();
    if (!isPrimaryChatModelId(model)) {
      setModel(DEFAULT_MODEL);
      lastTextModelRef.current = DEFAULT_MODEL;
    }
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  const requestModeChange = () => {
    if (loading || hasStreamingMessage()) return;
    setChatMode(CHAT_RUNTIME_MODE_CHAT);
  };

  const requestModelChange = (nextModel) => {
    if (loading || hasStreamingMessage()) return;

    const nextModelConfig = getModelConfig(nextModel);

    if (messages.length > 0 && model !== nextModel) {
      setConfirmModalConfig({
        title: "切换模型",
        message: `切换到 ${nextModelConfig?.name || "所选模型"} 需要新建对话。\n\n是否新建对话并切换模型？`,
        onConfirm: () => {
          resetConversation();
          setModel(nextModel);
          lastTextModelRef.current = nextModel;
        },
      });
      setShowConfirmModal(true);
      return;
    }

    setModel(nextModel);
    lastTextModelRef.current = nextModel;
    if (currentConversationId) {
      persistConversationModel(currentConversationId, nextModel);
    }
  };

  return {
    startNewChat,
    requestModeChange,
    requestModelChange,
  };
}
