"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const MODES = [
  { href: "/", label: "Chat" },
  { href: "/media", label: "Media" },
  { href: "/workbench", label: "工作台" },
];

export default function ModeSwitcher() {
  const pathname = usePathname();

  return (
    <nav aria-label="功能切换" className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-zinc-100/80 p-1 dark:bg-zinc-900">
      {MODES.map(({ href, label }) => {
        const active = pathname === href || (href === "/media" && pathname.startsWith("/media/"));
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors sm:px-4 sm:text-base ${
              active
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-white"
                : "text-zinc-500 hover:bg-white/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-white"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
