import Link from "next/link";

export default function MediaLayout({ children }) {
  return (
    <div className="min-h-[var(--app-height,100dvh)] bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
          <div>
            <h1 className="text-lg font-semibold">媒体工作台</h1>
            <p className="text-sm text-zinc-500">图片与视频生成</p>
          </div>
          <nav className="flex items-center gap-2">
            <Link href="/media/image" className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800">
              图片生成
            </Link>
            <Link href="/media/video" className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800">
              视频生成
            </Link>
            <Link href="/" className="rounded-lg px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10">
              返回聊天
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
