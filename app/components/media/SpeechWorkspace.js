"use client";

import { useI18n } from "@/lib/client/i18n";

import { useState } from "react";
import MediaWorkspaceHeading from "@/app/components/media/MediaWorkspaceHeading";
import AudioWorkspace from "@/app/components/media/AudioWorkspace";
import { AUDIO_PROVIDERS, AUDIO_PROVIDER_IDS } from "./audioProviders";
import { readLocalSetting, writeLocalSetting } from "@/lib/client/localSettings";
import { useClientReady } from "@/lib/client/hooks/useClientReady";
import { MediaServiceNotice } from './MediaShell';

const PROVIDER_KEY = 'vectaix_ui_audioProvider_v1';

function initialProvider(availability) {
  const saved = readLocalSetting(PROVIDER_KEY);
  if (AUDIO_PROVIDER_IDS.includes(saved) && (!availability || availability[saved])) return saved;
  return AUDIO_PROVIDER_IDS.find(id => !availability || availability[id]) ?? AUDIO_PROVIDER_IDS[0];
}

export default function SpeechWorkspace({ canManageDefaults = false, availability }) {
  const { t } = useI18n();
  // The saved choice lives in the browser, so wait until hydration finishes before picking a provider.
  const clientReady = useClientReady();
  const [chosen, setChosen] = useState(null);
  const [busy, setBusy] = useState(false);
  const provider = chosen ?? (clientReady ? initialProvider(availability) : null);
  const enabled = availability ? availability[provider] : true;
  function choose(id) {
    setChosen(id);
    writeLocalSetting(PROVIDER_KEY, id);
  }

  return <div className="space-y-6">
    <MediaWorkspaceHeading title={t("语音合成", "Text to speech")} description={t("选择或复刻音色，把文字变成自然语音。", "Choose or clone a voice, then turn text into natural speech.")} modelLabel={provider && AUDIO_PROVIDERS[provider].modelLabel} />
    {provider && <>
    <div role="radiogroup" aria-label={t("语音服务", "Speech service")} className="flex flex-wrap gap-2">
      {AUDIO_PROVIDER_IDS.map(id => <button key={id} type="button" role="radio" aria-checked={provider === id} disabled={busy} onClick={() => choose(id)} className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-4 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${provider === id ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700'}`}>
        {AUDIO_PROVIDERS[id].name}
        {availability && !availability[id] && <span className="text-xs text-zinc-400">{t("待开通", "Not enabled")}</span>}
      </button>)}
    </div>
    {availability && <MediaServiceNotice enabled={enabled} />}
    <AudioWorkspace key={provider} provider={provider} canManageDefaults={canManageDefaults} serviceEnabled={enabled} onBusyChange={setBusy} />
    </>}
  </div>;
}
