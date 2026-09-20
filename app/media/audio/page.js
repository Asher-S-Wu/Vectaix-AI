"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AudioLines, AudioWaveform, Mic2 } from "lucide-react";
import AudioWorkspaceHero from "@/app/components/media/AudioWorkspaceHero";
import AudioWorkspaceTabs from "@/app/components/media/AudioWorkspaceTabs";
import QwenAudioWorkspace from "@/app/components/media/QwenAudioWorkspace";
import MinimaxAudioWorkspace from "@/app/components/media/MinimaxAudioWorkspace";
import DoubaoAudioWorkspace from "@/app/components/media/DoubaoAudioWorkspace";

const providers = [
  { id: "qwen", label: "Qwen", icon: AudioLines, component: QwenAudioWorkspace },
  { id: "minimax", label: "MiniMax", icon: AudioWaveform, component: MinimaxAudioWorkspace },
  { id: "doubao", label: "豆包", icon: Mic2, component: DoubaoAudioWorkspace },
];

function AudioWorkspace() {
  const searchParams = useSearchParams();
  const provider = searchParams.get("provider") ?? "qwen";
  const [busy, setBusy] = useState(false);
  const Workspace = providers.find((item) => item.id === provider)?.component;

  const changeProvider = (nextProvider) => {
    if (busy || nextProvider === provider) return;
    const url = new URL(window.location.href);
    url.searchParams.set("provider", nextProvider);
    window.history.replaceState(null, "", url);
  };

  return (
    <div className="space-y-6">
      <AudioWorkspaceHero
        icon={AudioLines}
        title="语音合成"
        description="选择 Qwen、MiniMax 或豆包，把文字变成自然语音，创作你的专属声音。"
      >
        <AudioWorkspaceTabs
          idPrefix="audio-provider"
          tabs={providers}
          activeTab={provider}
          onChange={changeProvider}
          ariaLabel="语音服务商"
          disabled={busy}
        />
      </AudioWorkspaceHero>
      {Workspace ? (
        <section
          id={`audio-provider-panel-${provider}`}
          role="tabpanel"
          aria-labelledby={`audio-provider-tab-${provider}`}
        >
          <Workspace key={provider} onBusyChange={setBusy} />
        </section>
      ) : <p role="alert">该语音服务商不存在，请选择上方的服务商。</p>}
    </div>
  );
}

export default function AudioWorkspacePage() {
  return (
    <Suspense>
      <AudioWorkspace />
    </Suspense>
  );
}
