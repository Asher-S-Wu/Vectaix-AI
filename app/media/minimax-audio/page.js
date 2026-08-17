import { AudioWaveform } from "lucide-react";
import MinimaxAudioPanel from "@/app/components/media/MinimaxAudioPanel";

export default function MinimaxAudioWorkspacePage() {
  return (
    <div className="space-y-6">
      <section className="glass-effect overflow-hidden rounded-[28px] border border-zinc-200/60 dark:border-zinc-800/60">
        <div className="relative overflow-hidden px-5 py-5 sm:px-6">
          <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-24 h-52 w-52 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <AudioWaveform className="h-6 w-6" />
              </span>
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <h1 className="text-xl font-semibold tracking-tight">MiniMax 语音工作台</h1>
                  <span className="hidden rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary sm:inline">
                    2.8
                  </span>
                </div>
                <p className="max-w-2xl text-sm leading-6 text-zinc-500">
                  使用系统音色或你的专属声音，把文字变成自然、有情绪的语音。
                </p>
              </div>
            </div>
            <span className="w-fit rounded-full border border-zinc-200 bg-white/60 px-3 py-1.5 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/50">
              Speech 2.8 HD · Turbo
            </span>
          </div>
        </div>
      </section>

      <MinimaxAudioPanel />
    </div>
  );
}

