"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Clapperboard, ChevronUp, ImagePlus } from "lucide-react";
import {
  getModelConfig,
  getSelectableChatModels,
  MODEL_GROUP_ORDER,
  MODEL_GROUP_TITLES,
} from "@/lib/shared/models";
import { ModelGlyph } from "../common/ModelVisuals";

const MODEL_SELECTOR_GROUP_ORDER = Object.freeze([
  MODEL_GROUP_ORDER[0],
  "media",
  ...MODEL_GROUP_ORDER.slice(1),
]);
const MODEL_SELECTOR_GROUP_TITLES = Object.freeze({
  ...MODEL_GROUP_TITLES,
  media: "媒体模型",
});

function SelectorModelIcon({ item }) {
  if (item.mediaType === "image") {
    return <ImagePlus size={16} aria-hidden />;
  }
  if (item.mediaType === "video") {
    return <Clapperboard size={16} aria-hidden />;
  }
  return <ModelGlyph model={item.id} provider={item.provider} size={16} />;
}

export default function ModelSelector({
  model,
  onModelChange,
  ready = true,
  fullWidth = false,
}) {
  const [showModelMenu, setShowModelMenu] = useState(false);
  const currentModel = ready ? getModelConfig(model) : null;
  const currentModelLabel = currentModel?.name || "模型";
  const selectableModels = getSelectableChatModels();

  return (
    <div className="relative">
      <button
        onClick={() => {
          if (!ready) return;
          setShowModelMenu((value) => !value);
        }}
        className={`px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors flex items-center gap-1.5 text-sm ${fullWidth ? "w-full justify-between" : ""}`}
        type="button"
        disabled={!ready}
      >
        <span className="inline-flex h-3.5 w-3.5 items-center justify-center shrink-0">
          {currentModel ? (
            <ModelGlyph model={currentModel.id} provider={currentModel.provider} size={14} />
          ) : (
            <span className="block h-3.5 w-3.5 rounded-sm bg-zinc-200" aria-hidden />
          )}
        </span>
        <span className={fullWidth ? "truncate max-w-[148px]" : "hidden truncate max-w-[160px] sm:inline-block"}>{currentModelLabel}</span>
        <ChevronUp
          size={12}
          className={`transition-transform ${showModelMenu ? "rotate-180" : ""} ${ready ? "" : "opacity-40"}`}
        />
      </button>

      <AnimatePresence>
        {ready && showModelMenu && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40"
              onClick={() => setShowModelMenu(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute bottom-full left-0 mb-2 w-[min(88vw,248px)] bg-white dark:bg-zinc-900 rounded-xl shadow-pop border border-zinc-200 dark:border-zinc-700 p-2 z-50"
            >
              <div className="max-h-[360px] overflow-y-auto pr-1 mobile-scroll fade-scrollbar">
                {(() => {
                  const groups = {};
                  selectableModels.forEach((item) => {
                    const group = item.group || item.provider;
                    if (!groups[group]) groups[group] = [];
                    groups[group].push(item);
                  });
                  return MODEL_SELECTOR_GROUP_ORDER.filter((g) => groups[g]?.length).map((group, gi) => (
                    <div key={group}>
                      {gi > 0 && <div className="mx-2 my-1 border-t border-zinc-200 dark:border-zinc-700" />}
                      <div className="px-3 py-1.5 text-[10px] font-semibold text-zinc-400 tracking-wider">
                        {MODEL_SELECTOR_GROUP_TITLES[group] || group}
                      </div>
                      {groups[group].map((item) => (
                        <button
                          key={item.id}
                          onClick={() => {
                            if (!ready) return;
                            setShowModelMenu(false);
                            onModelChange(item.id);
                          }}
                          className={`w-full px-3 py-2.5 rounded-lg text-sm md:text-[13px] font-medium flex items-center gap-2.5 transition-all active:scale-[0.98] ${
                            model === item.id
                              ? "bg-primary text-white"
                              : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                          }`}
                          type="button"
                        >
                          <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                            <SelectorModelIcon item={item} />
                          </span>
                          <div className="min-w-0 flex-1 text-left leading-tight break-words">{item.name}</div>
                        </button>
                      ))}
                    </div>
                  ));
                })()}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
