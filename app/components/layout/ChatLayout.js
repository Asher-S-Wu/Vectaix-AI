"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import ChatHeader from "./ChatHeader";
import Composer from "../chat/Composer";
import MessageList from "../message/MessageList";
import ProfileModal from "../settings/ProfileModal";
import Sidebar from "./Sidebar";

export default function ChatLayout({
  user,
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
  currentConversationId,
  onStartNewChat,
  onLoadConversation,
  onDeleteConversation,
  onRenameConversation,
  onTogglePinConversation,
  onDuplicateConversation,
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
  editingImageAction,
  editingImage,
  fontSizeClass,
  onEditingContentChange,
  onEditingImageSelect,
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
    <div className="app-root flex font-sans overflow-hidden" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <ProfileModal open={showProfileModal} onClose={onCloseProfile} user={user} isAdmin={isAdmin} themeMode={themeMode} fontSize={fontSize} onThemeModeChange={onThemeModeChange} onFontSizeChange={onFontSizeChange} completionSoundVolume={completionSoundVolume} onCompletionSoundVolumeChange={onCompletionSoundVolumeChange} avatar={userAvatar} onAvatarChange={onAvatarChange} nickname={nickname} onNicknameChange={onNicknameChange} onEmailChange={onEmailChange} />
      <Sidebar isOpen={sidebarOpen} conversations={conversations} currentConversationId={currentConversationId} user={user} avatar={userAvatar} nickname={nickname} profileReady={isSettingsReady} onStartNewChat={onStartNewChat} onLoadConversation={onLoadConversation} onDeleteConversation={onDeleteConversation} onRenameConversation={onRenameConversation} onTogglePinConversation={onTogglePinConversation} onDuplicateConversation={onDuplicateConversation} onOpenProfile={onOpenProfile} onLogout={onLogout} onClose={onCloseSidebar} />
      {sidebarOpen ? (
        <button
          onClick={onCloseSidebar}
          type="button"
          aria-label="收起对话列表"
          className="fixed inset-0 z-[45] cursor-default bg-black/20 backdrop-blur-[2px] md:hidden"
        />
      ) : null}
      <div className="flex-1 flex flex-col w-full h-full relative overflow-hidden">
        <ChatHeader
          onToggleSidebar={onToggleSidebar}
          onStartNewChat={onStartNewChat}
          modelReady={isSettingsReady}
          sidebarOpen={sidebarOpen}
        />
        <main className="flex-1 flex flex-col min-h-0 relative">
          <MessageList
            messages={messages}
            loading={loading}
            chatEndRef={chatEndRef}
            listRef={messageListRef}
            onScroll={onMessageListScroll}
            editingMsgIndex={editingMsgIndex}
            editingContent={editingContent}
            editingImageAction={editingImageAction}
            editingImage={editingImage}
            fontSizeClass={fontSizeClass}
            model={composerProps?.model}
            onEditingContentChange={onEditingContentChange}
            onEditingImageSelect={onEditingImageSelect}
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
          <div className="composer-wrapper px-4 pb-4 md:pb-6 pt-2 z-20">
            <Composer {...composerProps} />
          </div>
        </main>
      </div>
    </div>
  );
}
