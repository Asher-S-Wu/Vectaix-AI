"use client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import ChatCapabilitiesSettings from "./components/chat/ChatCapabilitiesSettings";
import ChatResourcesPanel from "./components/chat/ChatResourcesPanel";
import ProjectManager from "./components/chat/ProjectManager";
import { useConversationTasks } from "@/lib/client/hooks/useConversationTasks";
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
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState("all");
  const [showProjects, setShowProjects] = useState(false);
  const [showResources, setShowResources] = useState(false);
  const [capabilitiesSection, setCapabilitiesSection] = useState(null);
  const selectedConversation = conversations.find(item => item._id === currentConversationId);
  const projectId = currentConversationId ? selectedConversation?.projectId || null : activeProjectId === "all" ? null : activeProjectId;
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const {
    model,
    isSettingsReady,
    setModel,
    webSearch,
    setWebSearch,
    chatMediaSettings: mediaSettings,
    setChatMediaSettings: setMediaSettings,
    resetChatMediaSettings,
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
    setProjects([]);
    setActiveProjectId("all");
    resetChatMediaSettings();
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
      const nextConversations = sortConversations(data?.conversations || []);
      setConversations(nextConversations);
      if (currentConversationIdRef.current && !nextConversations.some((conv) => conv._id === currentConversationIdRef.current)) {
        setCurrentConversationId(null);
        setMessages([]);
      }
    } catch {
      setConversationsError(true);
    }
    setConversationsReady(true);
  }

  async function fetchProjects() {
    try {
      const response = await fetch("/api/projects", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "加载项目失败");
      setProjects(data.projects);
      setActiveProjectId(previous => previous && previous !== "all" && !data.projects.some(project => project._id === previous) ? "all" : previous);
    } catch (error) { toast.error(error.message); }
  }
  const refreshProjects = useEffectEvent(fetchProjects);
  useEffect(() => {
    if (!user) return;
    const timer = setTimeout(() => refreshProjects(), 0);
    return () => clearTimeout(timer);
  }, [user]);

  const taskActions = useConversationTasks({
    user, conversationId: currentConversationId, projectId, model, webSearch, chatSystemPrompt, mediaSettings,
    setMessages, setCurrentConversationId, onActivity: fetchConversations,
    onCreditChange: () => refreshCredit().catch(() => {}), onAuthExpired: handleAuthExpired, toast, completionSoundVolume,
  });
  const busy = loading || taskActions.submitting || isStreaming;

  const actions = useChatAppActions({
    toast, messages, loading: busy, model, editingImages,
    setEditingMsgIndex, setEditingContent, setEditingImages,
  });

  const getMessageAttachments = (message) => (message?.parts || []).flatMap(part => {
    const file = part.inlineData || part.fileData;
    return file?.fileId ? [{ fileId: file.fileId, isImage: Boolean(part.inlineData) }] : [];
  });
  const regenerateMessage = async (index) => {
    if (busy) return;
    const previous = messages[index - 1];
    if (previous?.role !== "user") return;
    await taskActions.send({ text: previous.content, attachments: getMessageAttachments(previous), replaceFromMessageId: previous.id });
  };
  const submitEditedMessage = async () => {
    if (busy || editingMsgIndex === null) return;
    if (editingImages.some(image => image.uploadStatus !== "ready")) {
      toast.warning("请等待图片上传完成，或移除上传失败的图片");
      return;
    }
    const message = messages[editingMsgIndex];
    const attachments = [...getMessageAttachments(message).filter(file => !file.isImage), ...editingImages.map(image => ({ fileId: image.fileId }))];
    if (await taskActions.send({ text: editingContent, attachments, replaceFromMessageId: message.id })) actions.cancelEdit({ preserveUploaded: true });
  };
  const removeMessage = (index) => {
    if (!busy && messages[index]?.id) taskActions.deleteMessage(messages[index].id);
  };
  const moveConversation = async (id, nextProjectId) => {
    try {
      const response = await fetch(`/api/conversations/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: nextProjectId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "移动对话失败");
      await fetchConversations();
      if (id === currentConversationId) setActiveProjectId(nextProjectId);
    } catch (error) { toast.error(error.message); }
  };

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
          resourcesPanel={<ChatResourcesPanel open={showResources} onClose={() => setShowResources(false)} conversationId={currentConversationId} projectId={projectId} tasks={taskActions.tasks} />}
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
          conversations={conversations.filter(item => activeProjectId === "all" || (item.projectId || null) === activeProjectId)}
          projects={projects}
          activeProjectId={activeProjectId}
          onSelectProject={(id) => { setActiveProjectId(id); startNewChat(); }}
          onManageProjects={() => setShowProjects(true)}
          onMoveConversation={moveConversation}
          onOpenResources={() => setShowResources(true)}
          projectName={projects.find(item => item._id === projectId)?.name}
          taskLimits={taskActions.limits}
          tasks={taskActions.tasks}
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
          onSubmitEdit={submitEditedMessage}
          onCopy={actions.copyMessage}
          onDeleteModelMessage={removeMessage}
          onDeleteUserMessage={removeMessage}
          onRegenerateModelMessage={regenerateMessage}
          onStartEdit={actions.startEdit}
          userAvatar={avatar}
          onAvatarChange={setAvatar}
          composerProps={{
            loading: busy,
            isStreaming,
            isWaitingForAI: busy && messages.length > 0,
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
            onSend: taskActions.send,
            onOpenCapabilities: setCapabilitiesSection,
            onStop: taskActions.stop,
          }}
        />
      )}
      {!showAuthModal && <>
        <ProjectManager open={showProjects} onClose={() => setShowProjects(false)} projects={projects} onChanged={async () => { await fetchProjects(); await fetchConversations(); }} onSelectProject={(id) => { setActiveProjectId(id); startNewChat(); }} />
        <ChatCapabilitiesSettings open={Boolean(capabilitiesSection)} section={capabilitiesSection} onClose={() => setCapabilitiesSection(null)} projectId={projectId} mediaSettings={mediaSettings} onMediaSettingsChange={setMediaSettings} />
      </>}
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
