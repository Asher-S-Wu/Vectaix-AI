"use client";

import {
  CHAT_RUNTIME_MODE_CHAT,
  COUNCIL_MODEL_ID,
  DEFAULT_MODEL,
  getModelConfig,
  isCouncilModel,
  isImageGenModel,
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

  const getLastStandardModel = () => {
    const candidate = lastTextModelRef.current;
    if (isPrimaryChatModelId(candidate) && !isCouncilModel(candidate)) {
      return candidate;
    }
    return DEFAULT_MODEL;
  };

  const requestModeChange = (nextMode) => {
    if (loading || hasStreamingMessage()) return;

    if (nextMode === COUNCIL_MODEL_ID) {
      if (isCouncilModel(model)) return;

      const applyCouncilMode = () => {
        resetConversation();
        setModel(COUNCIL_MODEL_ID);
      };

      if (messages.length > 0) {
        setConfirmModalConfig({
          title: "切换模式",
          message: "切换到 Council 需要新建对话。Council 和普通模型不能在同一个会话里混用。\n\n是否新建对话并切换？",
          onConfirm: applyCouncilMode,
        });
        setShowConfirmModal(true);
        return;
      }

      applyCouncilMode();
      return;
    }

    if (isCouncilModel(model)) {
      const fallbackModel = getLastStandardModel();
      const applyStandardMode = () => {
        resetConversation();
        setModel(fallbackModel);
        lastTextModelRef.current = fallbackModel;
        setChatMode(CHAT_RUNTIME_MODE_CHAT);
      };

      if (messages.length > 0) {
        setConfirmModalConfig({
          title: "切换模式",
          message: "切换到 Chat 需要新建对话。Council 和普通模型不能在同一个会话里混用。\n\n是否新建对话并切换？",
          onConfirm: applyStandardMode,
        });
        setShowConfirmModal(true);
        return;
      }

      applyStandardMode();
    }
  };

  const requestModelChange = (nextModel) => {
    if (loading || hasStreamingMessage()) return;

    const currentIsCouncil = isCouncilModel(model);
    const nextModelConfig = getModelConfig(nextModel);
    const nextIsCouncil = isCouncilModel(nextModel);
    const currentIsImageGen = isImageGenModel(model);
    const nextIsImageGen = isImageGenModel(nextModel);
    const needsNewConversation = (currentIsCouncil !== nextIsCouncil)
      || (currentIsImageGen !== nextIsImageGen);

    if (messages.length > 0 && needsNewConversation) {
      let reason = "Council 和普通模型不能在同一个会话里混用。";
      if (currentIsImageGen || nextIsImageGen) {
        reason = "图片生成模型和文本模型不能在同一个会话里混用。";
      }
      setConfirmModalConfig({
        title: "切换模型",
        message: `切换到 ${nextModelConfig?.name || "所选模型"} 需要新建对话。\n${reason}\n\n是否新建对话并切换模型？`,
        onConfirm: () => {
          resetConversation();
          setModel(nextModel);
          if (!nextIsCouncil && !nextIsImageGen) {
            lastTextModelRef.current = nextModel;
          }
        },
      });
      setShowConfirmModal(true);
      return;
    }

    setModel(nextModel);
    if (!nextIsCouncil && !nextIsImageGen) {
      lastTextModelRef.current = nextModel;
    }
    if (currentConversationId && !currentIsCouncil && !nextIsCouncil && !currentIsImageGen && !nextIsImageGen) {
      persistConversationModel(currentConversationId, nextModel);
    }
  };

  return {
    startNewChat,
    requestModeChange,
    requestModelChange,
  };
}
