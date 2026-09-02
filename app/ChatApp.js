"use client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useChatAppActions } from "@/lib/client/chat/chatAppActions";
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
  DEFAULT_MODEL,
  resolveUsableModelId,
} from "@/lib/shared/models";
import { useToast } from "./components/common/ToastProvider";
import AuthModal from "./components/modals/AuthModal";
import ConfirmModal from "./components/modals/ConfirmModal";
import ChatLayout from "./components/layout/ChatLayout";
import { useCredits } from "@/lib/client/credits/CreditContext";

const FONT_SIZE_CLASSES = { small: "text-size-small", medium: "text-size-medium", large: "text-size-large" };
export default function ChatApp() {
  const toast = useToast();
  const { applyCreditSummary, clearCreditSummary, refreshCredit } = useCredits();
  const savedConversationRef = useRef(typeof window !== "undefined" ? window.localStorage.getItem("vectaix-current-conversation") : null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmModalConfig, setConfirmModalConfig] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [conversationsReady, setConversationsReady] = useState(false);
  const [conversationsError, setConversationsError] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const {
    model,
    isSettingsReady,
    setModel,
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
  const [editingImages, setEditingImages] = useState([]);
  const [composerPrefill, setComposerPrefill] = useState({ text: "", nonce: 0 });
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
    setConversationsReady(false);
    setConversationsError(false);
    setCurrentConversationId(null);
    setMessages([]);
    setSettingsError(null);
    setShowProfileModal(false);
    clearCreditSummary();
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
    const timer = window.setTimeout(() => {
      if (user?.credit) {
        applyCreditSummary(user.credit, { allowAccountSwitch: true });
        refreshCredit().catch(() => {});
      }
      else refreshCredit().catch(() => {});
    }, 0);
    return () => window.clearTimeout(timer);
  }, [applyCreditSummary, refreshCredit, user]);

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
      if (!res.ok) throw new Error("conversations fetch failed");
      setConversationsError(false);
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
    } catch {
      setConversationsError(true);
    }
    setConversationsReady(true);
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
      setComposerPrefill((previous) => ({ text: promptText, nonce: (previous?.nonce || 0) + 1 }));
    }
  };

  const actions = useChatAppActions({
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
    onSensitiveRefusal: handleSensitiveRefusal,
    onAuthExpired: handleAuthExpired,
    onConversationMissing: handleConversationMissing,
    onConversationActivity: () => {},
  });

  const persistConversationModel = async (conversationIdToUpdate, nextModel) => {
    if (!conversationIdToUpdate || !nextModel) return false;
    try {
      const response = await fetch(`/api/conversations/${conversationIdToUpdate}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: nextModel }),
      });
      if (!response.ok) return false;
      setConversations((prev) => prev.map((conversation) => (
        conversation?._id === conversationIdToUpdate
          ? { ...conversation, model: nextModel }
          : conversation
      )));
      return true;
    } catch {
      return false;
    }
  };

  const {
    startNewChat,
    requestModelChange,
  } = useChatModeController({
    loading,
    messages,
    model,
    setModel,
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

        const targetModel = resolveUsableModelId(conversation.model, DEFAULT_MODEL);
        if (targetModel !== model) {
          setModel(targetModel);
          lastTextModelRef.current = targetModel;
        }
        if (conversation.model !== targetModel) {
          await persistConversationModel(id, targetModel);
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

  const restoreConversation = useEffectEvent((id) => {
    loadConversation(id, { silent: true });
  });

  useEffect(() => {
    if (!user || !serverSettingsReady || hasRestoredConversationRef.current || conversations.length === 0) return;
    hasRestoredConversationRef.current = true;
    const savedConversationId = savedConversationRef.current;
    if (!savedConversationId) return;
    const exists = conversations.some((conversation) => conversation?._id === savedConversationId);
    if (!exists) return;
    const timer = setTimeout(() => restoreConversation(savedConversationId), 0);
    return () => clearTimeout(timer);
  }, [conversations, serverSettingsReady, user]);

  const syncConversationSettings = (settingsUpdate) => {
    if (!currentConversationId) return;
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
      const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      setConversations((prev) => prev.filter((c) => c._id !== id));
      if (currentConversationId === id) {
        setCurrentConversationId(null);
        setMessages([]);
      }
    } catch {
      toast.error("删除对话失败，请重试");
    }
  };

  const renameConversation = async (id, newTitle) => {
    try {
      const res = await fetch(`/api/conversations/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle }),
      });
      if (!res.ok) throw new Error("rename failed");
      setConversations((prev) =>
        prev.map((c) => (c._id === id ? { ...c, title: newTitle } : c))
      );
    } catch {
      toast.error("重命名失败，请重试");
    }
  };

  const togglePinConversation = async (id, nextPinned) => {
    try {
      const res = await fetch(`/api/conversations/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: nextPinned }),
      });
      if (!res.ok) throw new Error("pin failed");
      setConversations((prev) => {
        const next = prev.map((c) =>
          c._id === id ? { ...c, pinned: nextPinned, updatedAt: new Date().toISOString() } : c
        );
        return sortConversations(next);
      });
    } catch {
      toast.error("操作失败，请重试");
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
          conversationsReady={conversationsReady}
          conversationsError={conversationsError}
          onRetryConversations={fetchConversations}
          currentConversationId={currentConversationId}
          onStartNewChat={startNewChat}
          onLoadConversation={loadConversation}
          onDeleteConversation={deleteConversation}
          onRenameConversation={renameConversation}
          onTogglePinConversation={togglePinConversation}
          onOpenProfile={() => {
            setSidebarOpen(false);
            setShowProfileModal(true);
          }}
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
          editingImages={editingImages}
          fontSizeClass={FONT_SIZE_CLASSES[fontSize]}
          onEditingContentChange={setEditingContent}
          onEditingImagesSelect={actions.onEditingImagesSelect}
          onEditingImageRemove={actions.onEditingImageRemove}
          onCancelEdit={actions.cancelEdit}
          onSubmitEdit={actions.submitEditAndRegenerate}
          onCopy={actions.copyMessage}
          onDeleteModelMessage={actions.deleteModelMessage}
          onDeleteUserMessage={actions.deleteUserMessage}
          onRegenerateModelMessage={actions.regenerateModelMessage}
          onStartEdit={actions.startEdit}
          userAvatar={avatar}
          onAvatarChange={setAvatar}
          composerProps={{
            loading,
            isStreaming,
            isWaitingForAI: loading && messages.length > 0,
            model,
            modelReady: isSettingsReady,
            onModelChange: requestModelChange,
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
