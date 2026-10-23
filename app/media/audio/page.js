"use client";

import { AudioLines } from "lucide-react";
import AudioWorkspaceHero from "@/app/components/media/AudioWorkspaceHero";
import FishAudioWorkspace from "@/app/components/media/FishAudioWorkspace";

export default function AudioWorkspacePage() {
  return <div className="space-y-6">
    <AudioWorkspaceHero icon={AudioLines} title="语音合成" description="使用 Fish Audio S2.1 Pro，复刻自己的声音，把文字变成自然语音。" />
    <FishAudioWorkspace />
  </div>;
}
