"use client";
import { useEffect, useRef, useState } from "react";
import { createChatAppActions } from "@/lib/client/chat/chatAppActions";
import {
  decorateConversationMessages,
  mergeConversationMessages,
} from "@/lib/client/chat/conversationMessages";
import { useAuthSession } from "@/lib/client/hooks/useAuthSession";
import { useChatModeController } from "@/lib/client/hooks/useChatModeController";
import { useThemeMode } from "@/lib/client/hooks/useThemeMode";
import { useChatScroll } from "@/lib/client/hooks/useChatScroll";
import { useUserSettings } from "@/lib/client/hooks/useUserSettings";
import { normalizeWebSearchSettings } from "@/lib/shared/webSearch";
import {
  CHAT_RUNTIME_MODE_CHAT,
  getModelConfig,
  DEFAULT_MODEL,
  isCouncilModel,
  isImageGenModel,
  resolveUsableModelId,
} from "@/lib/shared/models";
import { useToast } from "./components/common/ToastProvider";
import AuthModal from "./components/modals/AuthModal";
import ConfirmModal from "./components/modals/ConfirmModal";
import ChatLayout from "./components/layout/ChatLayout";

const FONT_SIZE_CLASSES = { small: "text-size-small", medium: "text-size-medium", large: "text-size-large" };
export default function ChatApp() {
  const toast = useToast();
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmModalConfig, setConfirmModalConfig] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const mediaResolution = "MEDIA_RESOLUTION_HIGH";
  const {
    model,
    isSettingsReady,
    setModel,
    setChatMode,
    thinkingLevels,
    historyLimit,
    maxTokens,
    webSearch,
    setWebSearch,
    chatSystemPrompt,
    setChatSystemPrompt,
    systemPrompts,
    addSystemPrompt,
    updateSystemPrompt,
    deleteSystemPrompt,
    themeMode,
    setThemeMode,
    fontSize,
    setFontSize,
    completionSoundVolume,
    setCompletionSoundVolume,
    settingsError,
    setSettingsError,
    fetchSettings,
    avatar,
    setAvatar,
    nickname,
    setNickname,
  } = useUserSettings();
  useThemeMode(themeMode);
  const [editingMsgIndex, setEditingMsgIndex] = useState(null);
  const [editingContent, setEditingContent] = useState("");
  const [editingImageAction, setEditingImageAction] = useState("keep");
  const [editingImage, setEditingImage] = useState(null);
  const [composerPrefill, setComposerPrefill] = useState({ text: "", nonce: 0 });
  const [composerAttachmentRequest, setComposerAttachmentRequest] = useState(null);
  const [serverSettingsReady, setServerSettingsReady] = useState(false);

  const chatAbortRef = useRef(null);
  const chatRequestLockRef = useRef(false);
  const syncSettingsTimeoutRef = useRef(null);
  const pendingSettingsRef = useRef({});
  const pendingConversationIdRef = useRef(null);
  const lastTextModelRef = useRef(DEFAULT_MODEL);
  const hasRestoredConversationRef = useRef(false);
  const currentConversationIdRef = useRef(null);
  const isStreaming = messages.some((message) => message?.isStreaming === true);
  const {
    chatEndRef,
    messageListRef,
    userInterruptedRef,
    isStreamingRef,
    showScrollButton,
    handleMessageListScroll,
    scrollToBottom,
  } = useChatScroll({ messages, isStreaming });
  const lastSettingsErrorRef = useRef(null);

  useEffect(() => {
    if (settingsError && settingsError !== lastSettingsErrorRef.current) {
      toast.error(settingsError);
      lastSettingsErrorRef.current = settingsError;
    }
  }, [settingsError, toast]);

  const stopOngoingChatWork = () => {
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    chatRequestLockRef.current = false;
    userInterruptedRef.current = false;
    if (syncSettingsTimeoutRef.current) {
      clearTimeout(syncSettingsTimeoutRef.current);
      syncSettingsTimeoutRef.current = null;
    }
    pendingSettingsRef.current = {};
    pendingConversationIdRef.current = null;
    setLoading(false);
  };

  const handleSessionAuthenticated = ({ settingsReady } = {}) => {
    hasRestoredConversationRef.current = false;
    setSettingsError(null);
    setServerSettingsReady(settingsReady === true);
  };

  const handleSessionExpired = () => {
    hasRestoredConversationRef.current = false;
    setServerSettingsReady(false);
    setConversations([]);
    setCurrentConversationId(null);
    setMessages([]);
    setSettingsError(null);
    setShowProfileModal(false);
  };

  const {
    user,
    setUser,
    showAuthModal,
    authMode,
    setAuthMode,
    email,
    setEmail,
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    authLoading,
    handleAuth,
    handleLogout,
    handleAuthExpired,
  } = useAuthSession({
    toast,
    stopOngoingChatWork,
    fetchConversations,
    fetchSettings,
    onAuthenticated: handleSessionAuthenticated,
    onAuthExpired: handleSessionExpired,
  });

  useEffect(() => {
    currentConversationIdRef.current = currentConversationId;
    if (typeof window === "undefined") return;
    if (currentConversationId) {
      window.localStorage.setItem("vectaix-current-conversation", currentConversationId);
      return;
    }
    window.localStorage.removeItem("vectaix-current-conversation");
  }, [currentConversationId]);

  useEffect(() => {
    if (!user || !serverSettingsReady || hasRestoredConversationRef.current || conversations.length === 0) return;
    hasRestoredConversationRef.current = true;
    if (typeof window === "undefined") return;
    const savedConversationId = window.localStorage.getItem("vectaix-current-conversation");
    if (!savedConversationId) return;
    const exists = conversations.some((conversation) => conversation?._id === savedConversationId);
    if (exists) {
      loadConversation(savedConversationId, { silent: true });
    }
  }, [conversations, serverSettingsReady, user]);

  useEffect(() => {
    return () => {
      chatAbortRef.current?.abort();
      chatAbortRef.current = null;
      if (syncSettingsTimeoutRef.current) {
        clearTimeout(syncSettingsTimeoutRef.current);
        syncSettingsTimeoutRef.current = null;
      }
      pendingSettingsRef.current = {};
      pendingConversationIdRef.current = null;
    };
  }, []);

  const applyConversationSettings = (rawSettings) => {
    const settings = rawSettings && typeof rawSettings === "object"
      ? rawSettings
      : {};
    setChatMode(CHAT_RUNTIME_MODE_CHAT);
    setWebSearch(normalizeWebSearchSettings(settings.webSearch, { defaultEnabled: true }));
  };

  const sortConversations = (list) => {
    if (!Array.isArray(list)) return [];
    return list.slice().sort((a, b) => {
      const ap = a?.pinned ? 1 : 0;
      const bp = b?.pinned ? 1 : 0;
      if (ap !== bp) return bp - ap;

      const at = new Date(a?.updatedAt || 0).getTime();
      const bt = new Date(b?.updatedAt || 0).getTime();
      return bt - at;
    });
  };

  async function fetchConversations() {
    try {
      const res = await fetch("/api/conversations");
      if (res.status === 401) {
        handleAuthExpired();
        return;
      }
      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (!res.ok) return;
      let nextConversations = [];
      setConversations(() => {
        nextConversations = data?.conversations
          ? sortConversations(data.conversations)
          : [];
        return nextConversations;
      });
      if (currentConversationId && !nextConversations.some((conv) => conv._id === currentConversationId)) {
        setCurrentConversationId(null);
        setMessages([]);
      }
    } catch { }
  }

  const handleConversationMissing = () => {
    stopOngoingChatWork();
    setCurrentConversationId(null);
    setMessages([]);
    fetchConversations();
  };

  const handleSensitiveRefusal = (payload) => {
    const promptText = typeof payload === "string" ? payload : payload?.prompt;
    const shouldPrefill = typeof payload === "object" ? payload?.shouldPrefill !== false : true;
    toast.warning("消息包含敏感内容，请修改后重新尝试");
    if (shouldPrefill && typeof promptText === "string" && promptText.trim()) {
      setComposerPrefill({ text: promptText, nonce: Date.now() });
    }
  };

  const handleUseImageAsAttachment = (image) => {
    setComposerAttachmentRequest({
      ...image,
      nonce: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
  };

  const actions = createChatAppActions({
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
    onSensitiveRefusal: handleSensitiveRefusal,
    onAuthExpired: handleAuthExpired,
    onConversationMissing: handleConversationMissing,
    onConversationActivity: () => {},
  });

  const persistConversationModel = async (conversationIdToUpdate, nextModel) => {
    if (!conversationIdToUpdate || !nextModel || isCouncilModel(nextModel)) return;
    try {
      await fetch(`/api/conversations/${conversationIdToUpdate}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: nextModel }),
      });
      setConversations((prev) => prev.map((conversation) => (
        conversation?._id === conversationIdToUpdate
          ? { ...conversation, model: nextModel }
          : conversation
      )));
    } catch { }
  };

  const {
    startNewChat,
    requestModeChange,
    requestModelChange,
  } = useChatModeController({
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
  });

  const loadConversation = async (id, options = {}) => {
    const silent = options?.silent === true;
    if (currentConversationIdRef.current && currentConversationIdRef.current !== id && isStreamingRef.current) {
      stopOngoingChatWork();
    }
    if (!silent) {
      setLoading(true);
      setMessages([]);
      if (window.innerWidth < 768) setSidebarOpen(false);
    }
    try {
      const res = await fetch(`/api/conversations/${id}`, { cache: "no-store" });
      if (res.status === 401) {
        handleAuthExpired();
        throw new Error("登录已过期，请重新登录");
      }
      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (res.status === 404) {
        setConversations((prev) => prev.filter((conv) => conv._id !== id));
        if (currentConversationId === id) {
          setCurrentConversationId(null);
          setMessages([]);
        }
      }
      if (!res.ok) throw new Error(data?.error || "加载会话失败");
      if (data.conversation) {
        const conversation = data.conversation;
        if (silent && currentConversationIdRef.current && currentConversationIdRef.current !== id) {
          return;
        }
        userInterruptedRef.current = false;
        setMessages((prev) => {
          const serverMessages = Array.isArray(conversation.messages) ? conversation.messages : [];
          return silent
            ? mergeConversationMessages(serverMessages, prev)
            : decorateConversationMessages(serverMessages);
        });
        setCurrentConversationId(id);

        const targetModel = resolveUsableModelId(conversation.model, model);

        if (targetModel !== model) {
          setModel(targetModel);
          if (!isCouncilModel(targetModel) && !isImageGenModel(targetModel)) {
            lastTextModelRef.current = targetModel;
          }
        }

        applyConversationSettings(conversation.settings);
      }
    } catch (e) {
      if (!silent) {
        toast.error(`加载会话失败：${e?.message}`);
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  const syncConversationSettings = (settingsUpdate) => {
    if (!currentConversationId || isCouncilModel(model)) return;
    if (pendingConversationIdRef.current && pendingConversationIdRef.current !== currentConversationId) {
      pendingSettingsRef.current = {};
      if (syncSettingsTimeoutRef.current) {
        clearTimeout(syncSettingsTimeoutRef.current);
        syncSettingsTimeoutRef.current = null;
      }
    }
    pendingConversationIdRef.current = currentConversationId;
    pendingSettingsRef.current = { ...pendingSettingsRef.current, ...settingsUpdate };
    if (syncSettingsTimeoutRef.current) clearTimeout(syncSettingsTimeoutRef.current);
    syncSettingsTimeoutRef.current = setTimeout(async () => {
      const toSync = pendingSettingsRef.current;
      const targetId = pendingConversationIdRef.current;
      pendingSettingsRef.current = {};
      pendingConversationIdRef.current = null;
      if (!targetId) return;
      try {
        await fetch(`/api/conversations/${targetId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settings: toSync }),
        });
      } catch { }
    }, 500);
  };

  const deleteConversation = async (id, e) => {
    e?.stopPropagation?.();
    try {
      await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      setConversations((prev) => prev.filter((c) => c._id !== id));
      if (currentConversationId === id) {
        setCurrentConversationId(null);
        setMessages([]);
      }
    } catch { }
  };

  const renameConversation = async (id, newTitle) => {
    try {
      await fetch(`/api/conversations/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle }),
      });
      setConversations((prev) =>
        prev.map((c) => (c._id === id ? { ...c, title: newTitle } : c))
      );
    } catch { }
  };

  const togglePinConversation = async (id, nextPinned) => {
    try {
      await fetch(`/api/conversations/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: nextPinned }),
      });
      setConversations((prev) => {
        const next = prev.map((c) =>
          c._id === id ? { ...c, pinned: nextPinned, updatedAt: new Date().toISOString() } : c
        );
        return sortConversations(next);
      });
    } catch { }
  };

  const buildDuplicateTitle = (title) => {
    const sourceTitle = typeof title === "string" && title.trim() ? title.trim() : "新对话";
    const baseTitle = `${sourceTitle}（副本）`;
    const existingTitles = new Set(
      conversations
        .map((conv) => (typeof conv?.title === "string" ? conv.title.trim() : ""))
        .filter(Boolean)
    );
    if (!existingTitles.has(baseTitle)) return baseTitle;

    let index = 2;
    while (existingTitles.has(`${sourceTitle}（副本 ${index}）`)) {
      index += 1;
    }
    return `${sourceTitle}（副本 ${index}）`;
  };

  const duplicateConversation = async (id) => {
    try {
      const sourceRes = await fetch(`/api/conversations/${id}`);
      if (sourceRes.status === 401) {
        handleAuthExpired();
        return;
      }

      let sourceData = null;
      try {
        sourceData = await sourceRes.json();
      } catch {
        sourceData = null;
      }

      if (!sourceRes.ok) {
        throw new Error(sourceData?.error || "读取话题失败");
      }

      const sourceConversation = sourceData?.conversation;
      if (!sourceConversation) {
        throw new Error("未找到要复制的话题");
      }

      if (isCouncilModel(sourceConversation.model)) {
        return;
      }

      const createRes = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: buildDuplicateTitle(sourceConversation.title),
          model: sourceConversation.model,
          messages: Array.isArray(sourceConversation.messages) ? sourceConversation.messages : [],
          settings: sourceConversation.settings && typeof sourceConversation.settings === "object"
            ? sourceConversation.settings
            : undefined,
          pinned: false,
        }),
      });

      if (createRes.status === 401) {
        handleAuthExpired();
        return;
      }

      let createData = null;
      try {
        createData = await createRes.json();
      } catch {
        createData = null;
      }

      if (!createRes.ok) {
        throw new Error(createData?.error || "复制话题失败");
      }

      const duplicatedConversation = createData?.conversation;
      if (!duplicatedConversation?._id) {
        throw new Error("复制结果异常");
      }

      setCurrentConversationId(duplicatedConversation._id);
      setMessages(Array.isArray(duplicatedConversation.messages) ? duplicatedConversation.messages : []);

      const duplicatedModelId = resolveUsableModelId(duplicatedConversation.model, model);
      if (getModelConfig(duplicatedModelId)?.id) {
        setModel(duplicatedModelId);
        lastTextModelRef.current = duplicatedModelId;
      }

      applyConversationSettings(duplicatedConversation.settings);

      await fetchConversations();
      toast.success("已复制话题");
      if (window.innerWidth < 768) setSidebarOpen(false);
    } catch (error) {
      toast.error(error?.message || "复制话题失败");
    }
  };

  const updateThemeMode = (mode) => {
    setThemeMode(mode);
  };
  const updateFontSize = (size) => {
    setFontSize(size);
  };
  return (
    <>
      {showAuthModal ? (
        <AuthModal authMode={authMode} email={email} password={password} confirmPassword={confirmPassword} onEmailChange={setEmail} onPasswordChange={setPassword} onConfirmPasswordChange={setConfirmPassword} onSubmit={handleAuth} onToggleMode={() => setAuthMode((m) => (m === "login" ? "register" : "login"))} loading={authLoading} />
      ) : (
        <ChatLayout
          user={user}
          isAdmin={!!user?.isAdmin}
          isSettingsReady={isSettingsReady}
          showProfileModal={showProfileModal}
          onCloseProfile={() => setShowProfileModal(false)}
          themeMode={themeMode}
          fontSize={fontSize}
          onThemeModeChange={updateThemeMode}
          onFontSizeChange={updateFontSize}
          completionSoundVolume={completionSoundVolume}
          onCompletionSoundVolumeChange={setCompletionSoundVolume}
          nickname={nickname}
          onNicknameChange={setNickname}
          onEmailChange={(updatedUser) => setUser((prev) => ({ ...prev, email: updatedUser.email }))}
          sidebarOpen={sidebarOpen}
          conversations={conversations}
          currentConversationId={currentConversationId}
          onStartNewChat={startNewChat}
          onLoadConversation={loadConversation}
          onDeleteConversation={deleteConversation}
          onRenameConversation={renameConversation}
          onTogglePinConversation={togglePinConversation}
          onDuplicateConversation={duplicateConversation}
          onOpenProfile={() => setShowProfileModal(true)}
          onLogout={handleLogout}
          onCloseSidebar={() => setSidebarOpen(false)}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          messages={messages}
          loading={loading}
          chatEndRef={chatEndRef}
          messageListRef={messageListRef}
          onMessageListScroll={handleMessageListScroll}
          showScrollButton={showScrollButton}
          onScrollToBottom={scrollToBottom}
          editingMsgIndex={editingMsgIndex}
          editingContent={editingContent}
          editingImageAction={editingImageAction}
          editingImage={editingImage}
          fontSizeClass={FONT_SIZE_CLASSES[fontSize]}
          onEditingContentChange={setEditingContent}
          onEditingImageSelect={actions.onEditingImageSelect}
          onEditingImageRemove={actions.onEditingImageRemove}
          onEditingImageKeep={actions.onEditingImageKeep}
          onCancelEdit={actions.cancelEdit}
          onSubmitEdit={actions.submitEditAndRegenerate}
          onCopy={actions.copyMessage}
          onDeleteModelMessage={actions.deleteModelMessage}
          onDeleteUserMessage={actions.deleteUserMessage}
          onRegenerateModelMessage={actions.regenerateModelMessage}
          onStartEdit={actions.startEdit}
          onUseImageAsAttachment={handleUseImageAsAttachment}
          userAvatar={avatar}
          onAvatarChange={setAvatar}
          composerProps={{
            loading,
            isStreaming,
            isWaitingForAI: loading && messages.length > 0,
            model,
            modelReady: isSettingsReady,
            onModelChange: requestModelChange,
            onModeChange: requestModeChange,
            messages,
            historyLimit,
            webSearch,
            setWebSearch: (v) => {
              setWebSearch(v);
              syncConversationSettings({ webSearch: v });
            },
            chatSystemPrompt,
            onChatSystemPromptSave: setChatSystemPrompt,
            systemPrompts,
            addSystemPrompt,
            updateSystemPrompt,
            deleteSystemPrompt,
            onSend: actions.handleSendFromComposer,
            onStop: actions.stopStreaming,
            prefill: composerPrefill,
            attachmentRequest: composerAttachmentRequest,
          }}
        />
      )}
      <ConfirmModal
        open={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        onConfirm={() => {
          confirmModalConfig?.onConfirm();
          setShowConfirmModal(false);
        }}
        title={confirmModalConfig?.title}
        message={confirmModalConfig?.message}
        confirmText="确定"
        cancelText="取消"
      />
    </>
  );
}
