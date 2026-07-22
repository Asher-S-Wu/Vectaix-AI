import MediaHeader from "@/app/components/media/MediaHeader";
import PageScrollUnlock from "@/app/components/layout/PageScrollUnlock";

export default function MediaLayout({ children }) {
  return (
    <div className="min-h-[var(--app-height,100dvh)] bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <PageScrollUnlock />
      <MediaHeader />
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
