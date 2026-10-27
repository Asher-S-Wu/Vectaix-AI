"use client";

import { useI18n } from "@/lib/client/i18n";

import { AudioLines } from "lucide-react";
import AudioWorkspaceHero from "@/app/components/media/AudioWorkspaceHero";
import AudioWorkspace from "@/app/components/media/AudioWorkspace";
import { ELEVENLABS_AUDIO_MODEL_LABEL } from '@/lib/media/shared/elevenlabsAudio';
import { MediaServiceNotice } from './MediaShell';

export default function SpeechWorkspace({ canManageDefaults = false, availability }) {
  const { t } = useI18n();

  return <div className="space-y-6">
    {availability && <MediaServiceNotice enabled={availability.elevenlabs} />}
    <AudioWorkspaceHero icon={AudioLines} title={t("语音合成", "Text to speech")} description={t("使用 ElevenLabs 音色，复刻自己的声音，把文字变成自然语音。", "Choose an ElevenLabs voice, clone your voice, and turn text into natural speech.")}>
      <span className="text-sm text-zinc-500">{ELEVENLABS_AUDIO_MODEL_LABEL}</span>
    </AudioWorkspaceHero>
    <AudioWorkspace canManageDefaults={canManageDefaults} serviceEnabled={availability ? availability.elevenlabs : true} />
  </div>;
}
