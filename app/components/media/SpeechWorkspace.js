"use client";

import { useI18n } from "@/lib/client/i18n";

import MediaWorkspaceHeading from "@/app/components/media/MediaWorkspaceHeading";
import AudioWorkspace from "@/app/components/media/AudioWorkspace";
import { ELEVENLABS_AUDIO_MODEL_LABEL } from '@/lib/media/shared/elevenlabsAudio';
import { MediaServiceNotice } from './MediaShell';

export default function SpeechWorkspace({ canManageDefaults = false, availability }) {
  const { t } = useI18n();

  return <div className="space-y-6">
    {availability && <MediaServiceNotice enabled={availability.elevenlabs} />}
    <MediaWorkspaceHeading title={t("语音合成", "Text to speech")} description={t("选择或复刻音色，把文字变成自然语音。", "Choose or clone a voice, then turn text into natural speech.")} modelLabel={ELEVENLABS_AUDIO_MODEL_LABEL} />
    <AudioWorkspace canManageDefaults={canManageDefaults} serviceEnabled={availability ? availability.elevenlabs : true} />
  </div>;
}
