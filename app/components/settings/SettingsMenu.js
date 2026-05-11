"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Search, Settings2, MessageSquareQuote, X } from "lucide-react";
import { getModelConfig } from "@/lib/shared/models";
import { DEFAULT_WEB_SEARCH_SETTINGS } from "@/lib/shared/webSearch";
import SystemPromptModal from "./SystemPromptModal";

export default function SettingsMenu({
  model,
  webSearch,
  setWebSearch,
  chatSystemPrompt,
  onChatSystemPromptSave,
  systemPrompts,
  addSystemPrompt,
  updateSystemPrompt,
  deleteSystemPrompt,
}) {
  const [showSettings, setShowSettings] = useState(false);
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [mounted, setMounted] = useState(false);
  const modelConfig = getModelConfig(model);
  const supportsWebSearch = modelConfig?.supportsWebSearch === true;
  const webSearchSettings = webSearch && typeof webSearch === "object"
    ? { ...DEFAULT_WEB_SEARCH_SETTINGS, ...webSearch }
    : DEFAULT_WEB_SEARCH_SETTINGS;

  useEffect(() => {
    setMounted(true);
  }, []);

  const updateWebSearch = (patch) => {
    setWebSearch((prev) => ({
      ...(prev && typeof prev === "object" ? prev : DEFAULT_WEB_SEARCH_SETTINGS),
      ...patch,
    }));
  };

  return (
    <div className="relative">
      <button
        onClick={() => setShowSettings((value) => !value)}
        className={`px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-1.5 text-sm ${showSettings
          ? "bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300"
          : "border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
          }`}
        type="button"
      >
        <Settings2 size={14} />
        <span className="hidden sm:inline">设置</span>
      </button>

      {mounted ? createPortal(
        <AnimatePresence>
          {showSettings && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[55] flex items-center justify-center p-4 bg-black/40"
              onClick={() => setShowSettings(false)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ type: "spring", damping: 25, stiffness: 350 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-sm bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200/50 dark:border-zinc-700/50 overflow-hidden"
              >
                <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-zinc-800">
                  <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-2">
                    <Settings2 size={16} className="text-primary" />
                    对话设置
                  </h3>
                  <button
                    onClick={() => setShowSettings(false)}
                    className="p-1 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                    type="button"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="p-4 space-y-4">
                  {/* 智能联网 */}
                  {supportsWebSearch ? (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-zinc-600 dark:text-zinc-300 flex items-center gap-2">
                        <Search size={15} className="text-blue-500" />
                        智能联网
                      </span>
                      <button
                        onClick={() => updateWebSearch({ enabled: !webSearchSettings.enabled })}
                        type="button"
                        className={`relative w-10 h-[22px] rounded-full transition-colors ${webSearchSettings.enabled ? "bg-blue-600" : "bg-zinc-300 dark:bg-zinc-600"}`}
                      >
                        <span className={`absolute top-0.5 left-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-transform ${webSearchSettings.enabled ? "translate-x-[18px]" : ""}`} />
                      </button>
                    </div>
                  ) : null}

                  {/* 系统提示词 */}
                  <div>
                    <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400 px-1 mb-2 block">
                      系统提示词
                    </label>
                    <button
                      onClick={() => {
                        setShowSettings(false);
                        setShowPromptModal(true);
                      }}
                      type="button"
                      className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl border transition-colors text-sm bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                    >
                      <span className="flex items-center gap-2">
                        <MessageSquareQuote size={15} />
                        配置提示词
                      </span>
                      <span className="text-[10px] bg-zinc-200/60 dark:bg-zinc-700 px-2 py-0.5 rounded-full text-zinc-500 dark:text-zinc-400 font-medium">
                        {chatSystemPrompt ? "已设置" : "默认无"}
                      </span>
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      ) : null}
      <SystemPromptModal
        open={showPromptModal}
        onClose={() => setShowPromptModal(false)}
        chatSystemPrompt={chatSystemPrompt}
        onChatSystemPromptSave={onChatSystemPromptSave}
        systemPrompts={systemPrompts}
        addSystemPrompt={addSystemPrompt}
        updateSystemPrompt={updateSystemPrompt}
        deleteSystemPrompt={deleteSystemPrompt}
      />
    </div>
  );
}
