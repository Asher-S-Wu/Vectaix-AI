import Link from "@/app/components/layout/NavigationMotion";
import { ArrowUpRight, AudioLines, ImagePlus, ScanLine } from "lucide-react";
import { MEDIA_WORKSPACES } from "@/lib/media/shared/workspaces";

const WORKSPACE_VISUALS = {
  image: { icon: ImagePlus, label: "图片创作", color: "bg-sky-50 text-sky-600 dark:bg-sky-950/50 dark:text-sky-400" },
  audio: { icon: AudioLines, label: "语音创作", color: "bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400" },
  enhancement: { icon: ScanLine, label: "画质增强", color: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400" },
};

export default function MediaPage() {
  return (
    <section aria-labelledby="media-title" className="pb-6 sm:pb-10">
      <div className="py-5 sm:pb-10 sm:pt-8">
        <p className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">媒体工作台</p>
        <h1 id="media-title" className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl dark:text-white">
          让想法变成作品
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-7 text-zinc-500 sm:text-base dark:text-zinc-400">
          选择图片创作、语音合成或视频画质增强工具。
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MEDIA_WORKSPACES.map((workspace) => {
          const visual = WORKSPACE_VISUALS[workspace.kind];
          const Icon = visual.icon;
          return (
            <Link
              key={workspace.id}
              href={workspace.href}
              aria-labelledby={`workspace-${workspace.kind}-${workspace.id}`}
              className="group flex h-full flex-col rounded-2xl border border-zinc-200/80 bg-white p-5 transition-[transform,box-shadow,background-color,border-color] duration-200 motion-safe:hover:-translate-y-1 hover:shadow-md hover:border-sky-300 hover:bg-sky-50/30 focus-visible:outline-offset-4 sm:p-6 dark:border-zinc-800 dark:bg-zinc-900/40 dark:hover:border-sky-800 dark:hover:bg-zinc-900"
            >
              <div className="mb-6 flex items-center justify-between gap-3">
                <span className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl ${visual.color}`}>
                  <Icon size={23} strokeWidth={1.7} aria-hidden="true" />
                </span>
                <ArrowUpRight size={18} aria-hidden="true" className="text-zinc-300 transition-[transform,color] duration-200 motion-safe:group-hover:-translate-y-0.5 motion-safe:group-hover:translate-x-0.5 group-hover:text-sky-500 dark:text-zinc-600 dark:group-hover:text-sky-400" />
              </div>
              <p className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">{visual.label}</p>
              <h2 id={`workspace-${workspace.kind}-${workspace.id}`} className="text-lg font-semibold leading-7 tracking-tight text-zinc-900 dark:text-zinc-100">
                {workspace.name}
              </h2>
              <p className="mt-2 flex-1 text-sm leading-6 text-zinc-500 dark:text-zinc-400">{workspace.description}</p>
              <span className="mt-6 text-sm font-medium text-sky-600 dark:text-sky-400">进入工作台</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
