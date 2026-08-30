"use client";

import { createPortal } from "react-dom";
import { useState } from "react";
import { History, Settings } from "lucide-react";
import { useGuestSession } from "@/lib/client/GuestSession";
import { useUserSettings } from "@/lib/client/hooks/useUserSettings";
import ProfileModal from "@/app/components/settings/ProfileModal";
import GuestHistory from "./GuestHistory";

export default function GuestToolbar() {
  const guest = useGuestSession();
  if (!guest) return null;
  return <GuestToolbarContent guest={guest} />;
}

function GuestToolbarContent({ guest }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settings = useUserSettings();
  return <div className="flex w-full items-center justify-between gap-3 text-xs text-zinc-500">
    <p className="min-w-0"><span className="font-medium text-zinc-700 dark:text-zinc-300">{guest.user.name || "共享空间"}</span><span className="ml-2">此链接的使用者共享聊天、作品和设置</span></p>
    <div className="flex shrink-0 gap-1"><button type="button" onClick={() => setHistoryOpen(true)} className="inline-flex items-center gap-1 rounded-lg p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800" title="共享历史记录"><History size={15} /><span className="hidden sm:inline">历史</span></button><button type="button" onClick={() => { settings.fetchSettings(); setSettingsOpen(true); }} className="rounded-lg p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800" title="共享设置"><Settings size={15} /></button></div>
    {historyOpen && createPortal(<GuestHistory onClose={() => setHistoryOpen(false)} />, document.body)}
    {settingsOpen && createPortal(<ProfileModal open={settingsOpen} onClose={() => setSettingsOpen(false)} user={guest.user} isAdmin={false} themeMode={settings.themeMode} onThemeModeChange={settings.setThemeMode} fontSize={settings.fontSize} onFontSizeChange={settings.setFontSize} completionSoundVolume={settings.completionSoundVolume} onCompletionSoundVolumeChange={settings.setCompletionSoundVolume} avatar={settings.avatar} onAvatarChange={settings.setAvatar} nickname={settings.nickname} onNicknameChange={settings.setNickname} />, document.body)}
  </div>;
}
