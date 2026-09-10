"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import ChatHeader from "./ChatHeader";
import Composer from "../chat/Composer";
import MessageList from "../message/MessageList";
import Sidebar from "./Sidebar";

export default function ChatLayout({
  resourcesPanel,
  projects, activeProjectId, onSelectProject, onManageProjects, onMoveConversation, onOpenResources, projectName, tasks, taskLimits,
  user,
  assistant,
  isSettingsReady,
  showProfileModal,
  onCloseProfile,
  themeMode,
  fontSize,
  onThemeModeChange,
  onFontSizeChange,
  completionSoundVolume,
  onCompletionSoundVolumeChange,
  nickname,
  onNicknameChange,
  onEmailChange,
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
  onEditingImagesSelect,
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
  onAvatarChange,
  isAdmin,
}) {
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
            aria-label="收起对话列表"
            className="fixed inset-0 z-[45] bg-black/30 dark:bg-black/60 backdrop-blur-[2px] md:hidden"
          />
        ) : null}
      </AnimatePresence>
      <div className="flex-1 flex flex-col w-full h-full relative overflow-hidden">
        <ChatHeader
          onToggleSidebar={onToggleSidebar}
          onStartNewChat={onStartNewChat}
          sidebarOpen={sidebarOpen}
          onOpenResources={onOpenResources}
          projectName={projectName}
        />
        <main className="flex-1 flex flex-col min-h-0 relative">
          <MessageList
            taskLimits={taskLimits}
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
            model={composerProps?.model}
            onEditingContentChange={onEditingContentChange}
            onEditingImagesSelect={onEditingImagesSelect}
            onEditingImageRemove={onEditingImageRemove}
            onCancelEdit={onCancelEdit}
            onSubmitEdit={onSubmitEdit}
            onCopy={onCopy}
            onDeleteModelMessage={onDeleteModelMessage}
            onDeleteUserMessage={onDeleteUserMessage}
            onRegenerateModelMessage={onRegenerateModelMessage}
            onStartEdit={onStartEdit}
            onSendStarterPrompt={(text) => composerProps?.onSend?.({ text, attachments: [] })}
            userAvatar={userAvatar}
            userNickname={nickname}
            assistant={assistant}
          />
          <AnimatePresence>
            {showScrollButton && (
              <motion.button
                initial={{ opacity: 0, scale: 0.8, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.8, y: 10 }}
                transition={{ type: "spring", damping: 20, stiffness: 300 }}
                onClick={onScrollToBottom}
                className="absolute bottom-28 md:bottom-24 left-1/2 -translate-x-1/2 z-30 w-10 h-10 rounded-full glass-effect shadow-pop flex items-center justify-center text-zinc-500 hover:text-primary transition-all active:scale-95"
                type="button"
                aria-label="滚动到底部"
              >
                <ChevronDown size={22} />
              </motion.button>
            )}
          </AnimatePresence>
          <div className="composer-wrapper px-4 pt-2 z-20 safe-bottom">
            <Composer {...composerProps} />
          </div>
        </main>
      </div>
      {resourcesPanel}
    </div>
  );
}
