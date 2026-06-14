"use client";

import { CHAT_RUNTIME_MODE_CHAT } from "@/lib/shared/models";

export default function ModeSwitcher({ ready = true }) {
  if (!ready) {
    return <span className="truncate max-w-[140px] font-bold text-zinc-400 text-[17px] md:text-lg">Chat</span>;
  }

  return (
    <span className="truncate max-w-[140px] font-bold text-zinc-900 dark:text-white text-[17px] md:text-lg">
      Chat
    </span>
  );
}
