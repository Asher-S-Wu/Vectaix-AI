"use client";


import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { UI_THEME_MODE_KEY } from "@/lib/shared/storageKeys";
import ModeSwitcher from "@/app/components/layout/ModeSwitcher";
import { MEDIA_WORKSPACES } from "@/lib/media/shared/workspaces";

const THEME_CHANGE_EVENT = "vectaix-theme-change";
const THEME_MODE_CYCLE = ["system", "light", "dark"];

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

function getModeSnapshot() {
  return localStorage.getItem(UI_THEME_MODE_KEY) || "system";
}

function getServerModeSnapshot() {
  return "system";
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

const MODE_META = {
  system: { icon: Monitor, label: "跟随系统" },
  light: { icon: Sun, label: "浅色模式" },
  dark: { icon: Moon, label: "深色模式" },
};

export default function MediaHeader() {
  const pathname = usePathname();
  const mode = useSyncExternalStore(
    subscribeTheme,
    getModeSnapshot,
    getServerModeSnapshot,
  );

  const cycleTheme = () => {
    const next = THEME_MODE_CYCLE[(THEME_MODE_CYCLE.indexOf(mode) + 1) % THEME_MODE_CYCLE.length];
    if (next === "system") {
      localStorage.removeItem(UI_THEME_MODE_KEY);
    } else {
      localStorage.setItem(UI_THEME_MODE_KEY, next);
    }
    applyTheme(resolveIsDark(next));
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  };

  const ModeIcon = MODE_META[mode]?.icon || Monitor;

  return (
    <header className="sticky top-0 z-40 glass-effect border-b border-zinc-200/50">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
        <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-2">
          <ModeSwitcher />
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={cycleTheme}
              aria-label={`主题模式：${MODE_META[mode]?.label}，点击切换`}
              title={`主题：${MODE_META[mode]?.label}`}
              className="shrink-0 rounded-xl p-2 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 transition-colors"
            >
              <ModeIcon size={18} />
            </button>
          </div>
        </div>
        {pathname !== "/media" && <nav aria-label="媒体工作台" className="flex w-full items-center gap-1.5 overflow-x-auto no-scrollbar sm:gap-2">
          {MEDIA_WORKSPACES.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`shrink-0 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>}
      </div>
    </header>
  );
}
