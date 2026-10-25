"use client";

import { useI18n } from "@/lib/client/i18n";
import { animateChange, useMotionNavigation } from "./components/layout/NavigationMotion";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import ChatResourcesPanel from "./components/chat/ChatResourcesPanel";
import ProjectManager from "./components/chat/ProjectManager";
import { useConversationTasks } from "@/lib/client/hooks/useConversationTasks";
import { useChatAppActions } from "@/lib/client/chat/chatAppActions";
import { decorateConversationMessages } from "@/lib/client/chat/conversationMessages";
import { useAuthSession } from "@/lib/client/hooks/useAuthSession";
import { useChatScroll } from "@/lib/client/hooks/useChatScroll";
import { useUserSettings } from "@/lib/client/hooks/useUserSettings";
import { normalizeWebSearchSettings } from "@/lib/shared/webSearch";
import { useToast } from "./components/common/ToastProvider";
import TaskNotifications from "./components/common/TaskNotifications";
import AuthModal from "./components/modals/AuthModal";
import ChatLayout from "./components/layout/ChatLayout";

const FONT_SIZE_CLASSES = { small: "text-size-small", medium: "text-size-medium", large: "text-size-large" };
export default function ChatApp() {
  const { t, localizeMessage } = useI18n();
  const toast = useToast();
  const savedConversationRef = useRef(typeof window !== "undefined" ? window.localStorage.getItem("vectaix-current-conversation") : null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [conversationsReady, setConversationsReady] = useState(false);
  const [conversationsError, setConversationsError] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState("all");
  const [showProjects, setShowProjects] = useState(false);
  const { navigate } = useMotionNavigation();
  const [showResources, setShowResources] = useState(false);
  const openSettings = (section = "general") => { const query = new URLSearchParams({section}); if (currentConversationId) query.set("conversationId",currentConversationId); if (projectId) query.set("projectId",projectId); navigate(`/settings?${query}`); };
  const selectedConversation = conversations.find(item => item._id === currentConversationId);
  const projectId = currentConversationId ? selectedConversation?.projectId || null : activeProjectId === "all" ? null : activeProjectId;
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const {
    isSettingsReady,
    assistant,
    webSearch,
    setWebSearch,
    chatSystemPrompt,
    fontSize,
    completionSoundVolume,
    settingsError,
    fetchSettings,
    resetSettings,
    avatar,
    nickname,
  } = useUserSettings();
  const [editingMsgIndex, setEditingMsgIndex] = useState(null);
  const [editingContent, setEditingContent] = useState("");
  const [editingImages, setEditingImages] = useState([]);

  const conversationLoadRef = useRef(null);
  const conversationsRequestRef = useRef(null);
  const projectsRequestRef = useRef(null);
  const hasRestoredConversationRef = useRef(false);
  const currentConversationIdRef = useRef(null);
  const isStreaming = messages.some((message) => message?.isStreaming === true);
  const {
    chatEndRef,
    messageListRef,
    userInterruptedRef,
    showScrollButton,
    handleMessageListScroll,
    scrollToBottom,
  } = useChatScroll({ messages, isStreaming });
  const stopOngoingChatWork = () => {
    conversationLoadRef.current?.abort();
    conversationLoadRef.current = null;
    taskActions.invalidateView();
    actions.cancelEdit();
    userInterruptedRef.current = false;
    setLoading(false);
  };

  const resetSessionView = () => {
    conversationsRequestRef.current?.abort();
    projectsRequestRef.current?.abort();
    resetSettings();
    hasRestoredConversationRef.current = false;
    setConversations([]);
    setProjects([]);
    setActiveProjectId("all");
    setConversationsReady(false);
    setConversationsError(false);
    setCurrentConversationId(null);
    setMessages([]);
    setShowResources(false);
    setShowProjects(false);
  };

  const handleSessionExpired = () => {
    resetSessionView();
    savedConversationRef.current = null;
  };

  const {
    user,
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
    handlePasskeyAuth,
    handleLogout,
    handleAuthExpired,
  } = useAuthSession({
    toast,
    stopOngoingChatWork,
    fetchConversations,
    fetchSettings,
    onAuthenticated: resetSessionView,
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
    return () => {
      conversationLoadRef.current?.abort();
      conversationsRequestRef.current?.abort();
      projectsRequestRef.current?.abort();
    };
  }, []);

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
    conversationsRequestRef.current?.abort();
    const controller = new AbortController();
    conversationsRequestRef.current = controller;
    try {
      const res = await fetch("/api/conversations", { signal: controller.signal });
      if (controller.signal.aborted) return;
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
      if (controller.signal.aborted) return;
      if (!res.ok) throw new Error("conversations fetch failed");
      setConversationsError(false);
      const nextConversations = sortConversations(data?.conversations || []);
      setConversations(nextConversations);
      if (currentConversationIdRef.current && !nextConversations.some((conv) => conv._id === currentConversationIdRef.current)) {
        setCurrentConversationId(null);
        setMessages([]);
      }
    } catch {
      if (controller.signal.aborted) return;
      setConversationsError(true);
    }
    setConversationsReady(true);
  }

  async function fetchProjects() {
    projectsRequestRef.current?.abort();
    const controller = new AbortController();
    projectsRequestRef.current = controller;
    try {
      const response = await fetch("/api/projects", { cache: "no-store", signal: controller.signal });
      const data = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(data.error || t("加载项目失败", "Could not load projects"));
      setProjects(data.projects);
      setActiveProjectId(previous => previous && previous !== "all" && !data.projects.some(project => project._id === previous) ? "all" : previous);
    } catch (error) { if (!controller.signal.aborted) toast.error(localizeMessage(error.message)); }
  }
  const refreshProjects = useEffectEvent(fetchProjects);
  useEffect(() => {
    if (!user) return;
    const timer = setTimeout(() => refreshProjects(), 0);
    return () => clearTimeout(timer);
  }, [user]);

  const taskActions = useConversationTasks({
    user, conversationId: currentConversationId, projectId, webSearch, chatSystemPrompt, settingsReady: isSettingsReady,
    paused: loading,
    setMessages, setCurrentConversationId, onActivity: fetchConversations,
    onAuthExpired: handleAuthExpired, toast, completionSoundVolume,
  });
  const busy = loading || taskActions.submitting || isStreaming;

  const actions = useChatAppActions({
    messages, loading: busy,
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
    const message = messages[editingMsgIndex];
    const attachments = [...getMessageAttachments(message).filter(file => !file.isImage), ...editingImages.map(image => ({ fileId: image.fileId }))];
    if (await taskActions.send({ text: editingContent, attachments, replaceFromMessageId: message.id })) actions.cancelEdit();
  };
  const removeMessage = (index) => {
    if (!busy && messages[index]?.id) taskActions.deleteMessage(messages[index].id);
  };
  const moveConversation = async (id, nextProjectId) => {
    try {
      const response = await fetch(`/api/conversations/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: nextProjectId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t("移动对话失败", "Could not move the chat"));
      await fetchConversations();
      if (id === currentConversationId) setActiveProjectId(nextProjectId);
    } catch (error) { toast.error(localizeMessage(error.message)); }
  };

  const startNewChat = () => {
    stopOngoingChatWork();
    setCurrentConversationId(null);
    setMessages([]);
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  const loadConversation = async (id, options = {}) => {
    const silent = options?.silent === true;
    conversationLoadRef.current?.abort();
    taskActions.invalidateView();
    actions.cancelEdit();
    const controller = new AbortController();
    conversationLoadRef.current = controller;
    setLoading(true);
    if (!silent) {
      setMessages([]);
      if (window.innerWidth < 768) setSidebarOpen(false);
    }
    try {
      const res = await fetch(`/api/conversations/${id}`, { cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted) return;
      if (res.status === 401) {
        handleAuthExpired();
        throw new Error(t("登录已过期，请重新登录", "Your session has expired. Please sign in again."));
      }
      const data = await res.json();
      if (controller.signal.aborted) return;
      if (res.status === 404) {
        setConversations((prev) => prev.filter((conv) => conv._id !== id));
        if (currentConversationIdRef.current === id) {
          setCurrentConversationId(null);
          setMessages([]);
        }
      }
      if (!res.ok) throw new Error(data?.error || t("加载对话失败", "Could not load the chat"));
      if (data.conversation) {
        const conversation = data.conversation;
        userInterruptedRef.current = false;
        setMessages(decorateConversationMessages(conversation.messages));
        setCurrentConversationId(id);

        setWebSearch(normalizeWebSearchSettings(conversation.settings?.webSearch, { defaultEnabled: true }));
      }
    } catch (e) {
      if (!controller.signal.aborted && !silent) {
        toast.error(["加载对话失败：{error}", "Could not load the chat: {error}", { error: localizeMessage(e?.message) }]);
      }
    } finally {
      if (conversationLoadRef.current === controller) {
        conversationLoadRef.current = null;
        setLoading(false);
      }
    }
  };

  const restoreConversation = useEffectEvent((id) => {
    loadConversation(id, { silent: true });
  });

  useEffect(() => {
    if (!user || !isSettingsReady || hasRestoredConversationRef.current || conversations.length === 0) return;
    hasRestoredConversationRef.current = true;
    const savedConversationId = savedConversationRef.current;
    if (!savedConversationId) return;
    const exists = conversations.some((conversation) => conversation?._id === savedConversationId);
    if (!exists) return;
    const timer = setTimeout(() => restoreConversation(savedConversationId), 0);
    return () => clearTimeout(timer);
  }, [conversations, isSettingsReady, user]);

  const deleteConversation = async (id, e) => {
    e?.stopPropagation?.();
    try {
      const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      setConversations((prev) => prev.filter((c) => c._id !== id));
      if (currentConversationIdRef.current === id) {
        stopOngoingChatWork();
        setCurrentConversationId(null);
        setMessages([]);
      }
    } catch {
      toast.error(["删除对话失败，请重试", "Could not delete the chat. Please try again."]);
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
      toast.error(["重命名失败，请重试", "Could not rename the chat. Please try again."]);
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
      toast.error(["操作失败，请重试", "The action failed. Please try again."]);
    }
  };

  return (
    <>
      {showAuthModal ? (
        <AuthModal authMode={authMode} email={email} password={password} confirmPassword={confirmPassword} onEmailChange={setEmail} onPasswordChange={setPassword} onConfirmPasswordChange={setConfirmPassword} onSubmit={handleAuth} onPasskey={handlePasskeyAuth} onToggleMode={() => setAuthMode((m) => (m === "login" ? "register" : "login"))} loading={authLoading} />
      ) : (
        <ChatLayout
          resourcesPanel={<ChatResourcesPanel open={showResources} onClose={() => animateChange(() => setShowResources(false), "resources")} conversationId={currentConversationId} projectId={projectId} tasks={taskActions.tasks} />}
          user={user}
          assistant={assistant}
          isSettingsReady={isSettingsReady}
          settingsError={settingsError}
          onRetrySettings={fetchSettings}
          nickname={nickname}
          sidebarOpen={sidebarOpen}
          conversations={conversations.filter(item => activeProjectId === "all" || (item.projectId || null) === activeProjectId)}
          projects={projects}
          activeProjectId={activeProjectId}
          onSelectProject={(id) => { setActiveProjectId(id); startNewChat(); }}
          onManageProjects={() => setShowProjects(true)}
          onMoveConversation={moveConversation}
          onOpenResources={() => animateChange(() => setShowResources(true), "resources")}
          onOpenUsage={() => openSettings("usage")}
          projectName={projects.find(item => item._id === projectId)?.name}
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
            openSettings("general");
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
          onEditingImageRemove={actions.onEditingImageRemove}
          onCancelEdit={actions.cancelEdit}
          onSubmitEdit={submitEditedMessage}
          onCopy={actions.copyMessage}
          onDeleteModelMessage={removeMessage}
          onDeleteUserMessage={removeMessage}
          onRegenerateModelMessage={regenerateMessage}
          onStartEdit={actions.startEdit}
          userAvatar={avatar}
          composerProps={{
            loading: busy || !isSettingsReady,
            isStreaming,
            isWaitingForAI: busy && messages.length > 0,
            onSend: taskActions.send,
            onStop: taskActions.stop,
          }}
        />
      )}
      {!showAuthModal && <>
        <TaskNotifications userId={user?.id} />
        <ProjectManager open={showProjects} onClose={() => setShowProjects(false)} projects={projects} onChanged={async () => { await fetchProjects(); await fetchConversations(); }} onSelectProject={(id) => { setActiveProjectId(id); startNewChat(); }} />
      </>}
    </>
  );
}
