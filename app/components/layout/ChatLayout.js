"use client";

import { useI18n } from "@/lib/client/i18n";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import ChatHeader from "./ChatHeader";
import Composer from "../chat/Composer";
import MessageList from "../message/MessageList";
import Sidebar from "./Sidebar";

export default function ChatLayout({
  resourcesPanel,
  projects, activeProjectId, onSelectProject, onManageProjects, onMoveConversation, onOpenResources, projectName, tasks,
  user,
  assistant,
  isSettingsReady,
  settingsError,
  onRetrySettings,
  nickname,
  sidebarOpen,
  conversations,
  conversationsReady = true,
  conversationsError = false,
  onRetryConversations,
  currentConversationId,
  onStartNewChat,
  onLoadConversation,
  onDeleteConversation,
  onRenameConversation,
  onTogglePinConversation,
  onOpenProfile,
  onOpenUsage,
  onLogout,
  onCloseSidebar,
  onToggleSidebar,
  messages,
  loading,
  chatEndRef,
  messageListRef,
  onMessageListScroll,
  showScrollButton,
  onScrollToBottom,
  editingMsgIndex,
  editingContent,
  editingImages,
  fontSizeClass,
  onEditingContentChange,
  onEditingImageRemove,
  onCancelEdit,
  onSubmitEdit,
  onCopy,
  onDeleteModelMessage,
  onDeleteUserMessage,
  onRegenerateModelMessage,
  onStartEdit,
  composerProps,
  userAvatar,
}) {
  const { t, localizeMessage } = useI18n();
  useEffect(() => {
    if (!sidebarOpen) return undefined;
    const handleKeyDown = event => {
      if (event.key === "Escape" && !event.defaultPrevented && window.innerWidth < 768) onCloseSidebar();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [sidebarOpen, onCloseSidebar]);
  return (
    <div className="app-root flex overflow-hidden" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <Sidebar projects={projects} activeProjectId={activeProjectId} onSelectProject={onSelectProject} onManageProjects={onManageProjects} onMoveConversation={onMoveConversation} isOpen={sidebarOpen} conversations={conversations} conversationsReady={conversationsReady} conversationsError={conversationsError} onRetryConversations={onRetryConversations} currentConversationId={currentConversationId} user={user} avatar={userAvatar} nickname={nickname} profileReady={isSettingsReady} onStartNewChat={onStartNewChat} onLoadConversation={onLoadConversation} onDeleteConversation={onDeleteConversation} onRenameConversation={onRenameConversation} onTogglePinConversation={onTogglePinConversation} onOpenProfile={onOpenProfile} onLogout={onLogout} onClose={onCloseSidebar} />
      <AnimatePresence>
        {sidebarOpen ? (
          <motion.button
            key="sidebar-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onCloseSidebar}
            type="button"
            aria-label={t("收起对话列表", "Close chat list")}
            tabIndex={-1}
            className="fixed inset-0 z-[45] bg-black/30 dark:bg-black/60 md:hidden"
          />
        ) : null}
      </AnimatePresence>
      <div style={{ viewTransitionName: "workspace-content" }} className="min-w-0 flex-1 flex flex-col w-full h-full relative overflow-hidden">
        <ChatHeader
          title={conversations.find(conversation => conversation._id === currentConversationId)?.title}
          showMascot={messages.length > 0 || loading}
          onToggleSidebar={onToggleSidebar}
          onStartNewChat={onStartNewChat}
          sidebarOpen={sidebarOpen}
          onOpenResources={onOpenResources}
          projectName={projectName}
          userId={user?.id}
          tasks={tasks}
          onOpenUsage={onOpenUsage}
        />
        <main className="flex-1 flex flex-col min-h-0 relative">
          <MessageList
            tasks={tasks}
            messages={messages}
            loading={loading}
            chatEndRef={chatEndRef}
            listRef={messageListRef}
            onScroll={onMessageListScroll}
            editingMsgIndex={editingMsgIndex}
            editingContent={editingContent}
            editingImages={editingImages}
            fontSizeClass={fontSizeClass}
            onEditingContentChange={onEditingContentChange}
            onEditingImageRemove={onEditingImageRemove}
            onCancelEdit={onCancelEdit}
            onSubmitEdit={onSubmitEdit}
            onCopy={onCopy}
            onDeleteModelMessage={onDeleteModelMessage}
            onDeleteUserMessage={onDeleteUserMessage}
            onRegenerateModelMessage={onRegenerateModelMessage}
            onStartEdit={onStartEdit}
            onSendStarterPrompt={(text) => composerProps?.onSend?.({ text, attachments: [] })}
            starterPromptsDisabled={Boolean(composerProps?.loading)}
            userAvatar={userAvatar}
            userNickname={nickname}
            assistant={assistant}
          />
          <div className="composer-wrapper relative px-4 pt-2 z-20 safe-bottom">
            <AnimatePresence>
              {showScrollButton && (
                <motion.button
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.16 }}
                  onClick={onScrollToBottom}
                  style={{ x: "-50%" }}
                  className="absolute bottom-full left-1/2 z-30 mb-2 flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 shadow-pop transition-colors hover:text-primary dark:border-zinc-700"
                  type="button"
                  aria-label={t("滚动到底部", "Scroll to bottom")}
                >
                  <ChevronDown size={22} />
                </motion.button>
              )}
            </AnimatePresence>
            {settingsError && (
              <div role="alert" className="mx-auto mb-2 flex max-w-4xl items-center justify-between gap-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
                <span>{t("设置加载失败：{error}", "Could not load settings: {error}", { error: localizeMessage(settingsError) })}</span>
                <button type="button" onClick={onRetrySettings} className="shrink-0 rounded-lg px-3 py-1.5 font-medium hover:bg-red-100 dark:hover:bg-red-900/40">
                  {t("重新加载设置", "Reload settings")}
                </button>
              </div>
            )}
            <Composer {...composerProps} />
          </div>
        </main>
      </div>
      {resourcesPanel}
    </div>
  );
}
