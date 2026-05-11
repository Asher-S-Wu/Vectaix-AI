"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import {
  CHAT_RUNTIME_MODE_CHAT,
  COUNCIL_MODEL_ID,
  isCouncilModel,
} from "@/lib/shared/models";

const MODE_OPTIONS = Object.freeze([
  {
    id: CHAT_RUNTIME_MODE_CHAT,
    label: "Chat",
    description: "标准聊天模式",
  },
  {
    id: COUNCIL_MODEL_ID,
    label: "Council",
    description: "多模型协作模式",
  },
]);

export default function ModeSwitcher({
  model,
  onModeChange,
  ready = true,
}) {
  const [showModeMenu, setShowModeMenu] = useState(false);
  const currentModeId = isCouncilModel(model) ? COUNCIL_MODEL_ID : CHAT_RUNTIME_MODE_CHAT;
  const currentMode = MODE_OPTIONS.find((item) => item.id === currentModeId) || MODE_OPTIONS[0];

  return (
    <div className="relative">
      <button
        onClick={() => {
          if (!ready) return;
          setShowModeMenu((value) => !value);
        }}
        className="px-1 py-1 rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors flex items-center gap-1.5"
        type="button"
        disabled={!ready}
      >
        <span className="truncate max-w-[140px] font-bold text-zinc-900 dark:text-white text-[17px] md:text-lg">{currentMode.label}</span>
        <ChevronDown
          size={14}
          className={`transition-transform ${showModeMenu ? "rotate-180" : ""} ${ready ? "" : "opacity-40"}`}
        />
      </button>

      <AnimatePresence>
        {ready && showModeMenu && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40"
              onClick={() => setShowModeMenu(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              className="absolute top-full left-0 mt-2 w-[min(88vw,220px)] bg-white dark:bg-zinc-900 rounded-xl shadow-lg border border-zinc-200 dark:border-zinc-700 p-2 z-50"
            >
              <div className="px-3 py-1.5 text-[10px] font-semibold text-zinc-400 tracking-wider">
                模式
              </div>
              {MODE_OPTIONS.map((item) => {
                const active = currentModeId === item.id;
                const disabled = item.disabled === true;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      if (!ready || active || disabled) return;
                      setShowModeMenu(false);
                      onModeChange?.(item.id);
                    }}
                    className={`w-full px-3 py-2.5 rounded-lg text-left transition-colors ${
                      active
                        ? "bg-zinc-600 text-white"
                        : disabled
                          ? "text-zinc-400 dark:text-zinc-500 cursor-not-allowed"
                          : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    }`}
                    type="button"
                    disabled={disabled}
                    aria-disabled={disabled}
                  >
                    <div className="font-medium text-sm">{item.label}</div>
                    <div className={`text-xs mt-0.5 ${active ? "text-zinc-200" : "text-zinc-400 dark:text-zinc-500"}`}>
                      {item.description}
                    </div>
                  </button>
                );
              })}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
