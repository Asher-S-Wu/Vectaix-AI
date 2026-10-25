"use client";

import { useI18n } from "@/lib/client/i18n";

import { AudioLines } from "lucide-react";
import AudioWorkspaceHero from "@/app/components/media/AudioWorkspaceHero";
import FishAudioWorkspace from "@/app/components/media/FishAudioWorkspace";

export default function AudioWorkspacePage() {
  const { t } = useI18n();

  return <div className="space-y-6">
    <AudioWorkspaceHero icon={AudioLines} title={t("语音合成", "Text to speech")} description={t("使用 Fish Audio S2.1 Pro，复刻自己的声音，把文字变成自然语音。", "Clone your voice and turn text into natural speech with Fish Audio S2.1 Pro.")} />
    <FishAudioWorkspace />
  </div>;
}
