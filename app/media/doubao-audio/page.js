import { AudioLines } from "lucide-react";
import DoubaoAudioPanel from "@/app/components/media/DoubaoAudioPanel";
import {
  DOUBAO_AUDIO_MODEL,
  DOUBAO_AUDIO_MODEL_NAME,
} from "@/lib/media/shared/doubaoAudio";

export default function DoubaoAudioWorkspacePage() {
  return (
    <div className="space-y-6">
      <section className="glass-effect overflow-hidden rounded-[28px] border border-zinc-200/60 dark:border-zinc-800/60">
        <div className="relative overflow-hidden px-5 py-5 sm:px-6">
          <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-24 h-52 w-52 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <AudioLines className="h-6 w-6" />
              </span>
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <h1 className="text-xl font-semibold tracking-tight">Doubao 音频工作台</h1>
                  <span className="hidden rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary sm:inline">
                    1.0
                  </span>
                </div>
                <p className="max-w-2xl text-sm leading-6 text-zinc-500">
                  用文字或参考音频创作配音、音效和场景声。
                </p>
              </div>
            </div>
            <span className="w-fit rounded-full border border-zinc-200 bg-white/60 px-3 py-1.5 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/50">
              {DOUBAO_AUDIO_MODEL_NAME} · {DOUBAO_AUDIO_MODEL}
            </span>
          </div>
        </div>
      </section>

      <DoubaoAudioPanel />
    </div>
  );
}
