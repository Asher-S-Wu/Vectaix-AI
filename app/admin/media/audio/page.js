"use client";

import { useI18n } from "@/lib/client/i18n";

import { AudioLines } from "lucide-react";
import { useState } from 'react';
import AudioWorkspaceHero from "@/app/components/media/AudioWorkspaceHero";
import AudioWorkspace from "@/app/components/media/AudioWorkspace";
import { QWEN_AUDIO_MODEL_LABEL } from '@/lib/media/shared/qwenAudio';
import { FISH_AUDIO_MODEL_LABEL } from '@/lib/media/shared/fishAudio';

export default function AudioWorkspacePage() {
  const { t } = useI18n();
  const [provider, setProvider] = useState('fish');
  const [busy, setBusy] = useState(false);

  return <div className="space-y-6">
    <AudioWorkspaceHero icon={AudioLines} title={t("语音合成", "Text to speech")} description={t("选择语音模型，复刻自己的声音，把文字变成自然语音。", "Choose a speech model, clone your voice, and turn text into natural speech.")}>
      <label className="flex flex-wrap items-center gap-3 text-sm">{t("语音模型", "Speech model")}<select aria-label={t("语音模型", "Speech model")} value={provider} disabled={busy} onChange={event => setProvider(event.target.value)} className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-950"><option value="fish">{FISH_AUDIO_MODEL_LABEL}</option><option value="qwen">{QWEN_AUDIO_MODEL_LABEL} · {t("新加坡", "Singapore")}</option></select></label>
    </AudioWorkspaceHero>
    <AudioWorkspace key={provider} provider={provider} onBusyChange={setBusy} />
  </div>;
}
