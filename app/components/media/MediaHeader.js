"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { UI_THEME_MODE_KEY } from "@/lib/shared/storageKeys";

const THEME_CHANGE_EVENT = "vectaix-theme-change";

function applyTheme(isDark) {
  const root = document.documentElement;
  root.classList.toggle("dark-mode", isDark);
  document.body.classList.toggle("dark-mode", isDark);
  root.style.colorScheme = isDark ? "dark" : "light";
  root.style.backgroundColor = isDark ? "#09090b" : "#ffffff";
}

function resolveIsDark(mode) {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function getThemeSnapshot() {
  const mode = localStorage.getItem(UI_THEME_MODE_KEY) || "system";
  return resolveIsDark(mode);
}

function getServerThemeSnapshot() {
  return false;
}

function subscribeTheme(onStoreChange) {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange);
  mediaQuery.addEventListener("change", onStoreChange);

  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange);
    mediaQuery.removeEventListener("change", onStoreChange);
  };
}

export default function MediaHeader() {
  const pathname = usePathname();
  const isDark = useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );

  const toggleTheme = () => {
    const next = !isDark;
    localStorage.setItem(UI_THEME_MODE_KEY, next ? "dark" : "light");
    applyTheme(next);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  };

  const navItems = [
    { href: "/media/image", label: "图片生成" },
    { href: "/media/video", label: "视频生成" },
  ];

  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
        <div>
          <h1 className="text-lg font-semibold">媒体工作台</h1>
          <p className="text-sm text-zinc-500">图片与视频生成</p>
        </div>
        <nav className="flex items-center gap-2">
          {navItems.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
          <Link
            href="/"
            className="rounded-xl px-3 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            返回聊天
          </Link>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={isDark ? "切换到浅色模式" : "切换到深色模式"}
            className="rounded-xl p-2 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </nav>
      </div>
    </header>
  );
}
