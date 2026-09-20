"use client";

import { usePathname } from "next/navigation";
import TransitionLink, { useMotionNavigation } from "./NavigationMotion";

const MODES = [
  { href: "/", label: "Agent" },
  { href: "/media", label: "Media" },
];

export default function ModeSwitcher() {
  const pathname = usePathname();
  const { pendingHref } = useMotionNavigation();
  const selectedPath = pendingHref || pathname;
  const media = selectedPath.startsWith("/media");

  return (
    <nav aria-label="功能切换" data-mode={media ? "media" : "agent"} className="workspace-switch relative isolate grid shrink-0 grid-cols-2 rounded-xl bg-zinc-100/80 p-1 dark:bg-zinc-900">
      <span aria-hidden="true" className="workspace-switch-thumb selection-surface pointer-events-none absolute bottom-1 left-1 top-1 -z-10 rounded-lg shadow-sm" />
      {MODES.map(({ href, label }, index) => {
        const active = media === Boolean(index);
        return (
          <TransitionLink key={href} href={href} mode aria-current={active ? "page" : undefined}
            className={`rounded-lg px-3 py-2 text-center text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:px-4 sm:text-base ${active ? "text-zinc-900 dark:text-white" : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"}`}>
            {label}
          </TransitionLink>
        );
      })}
    </nav>
  );
}
