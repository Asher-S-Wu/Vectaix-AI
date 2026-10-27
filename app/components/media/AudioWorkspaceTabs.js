"use client";

import { useId } from "react";
import { motion, useReducedMotion } from "framer-motion";

export default function AudioWorkspaceTabs({ tabs, activeTab, onChange, ariaLabel, idPrefix, disabled = false }) {
  const reduceMotion = useReducedMotion();
  const generatedId = useId();
  const layoutId = idPrefix || generatedId;

  const handleKeyDown = (event) => {
    if (disabled) return;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabElements = Array.from(event.currentTarget.querySelectorAll('[role="tab"]'));
    const currentTab = event.target.closest('[role="tab"]');
    const currentIndex = tabElements.indexOf(currentTab);
    if (currentIndex < 0) return;

    event.preventDefault();
    let nextIndex = currentIndex;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabElements.length - 1;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabElements.length) % tabElements.length;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabElements.length;
    const nextTab = tabElements[nextIndex];
    onChange(nextTab.dataset.tabId);
    nextTab.focus();
  };

  return (
    <div
      className="relative grid gap-2 rounded-2xl border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-700"
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
    >
      {tabs.map((tab) => {
        const active = activeTab === tab.id;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            id={`${layoutId}-tab-${tab.id}`}
            type="button"
            role="tab"
            disabled={disabled}
            aria-controls={active ? `${layoutId}-panel-${tab.id}` : undefined}
            aria-selected={active}
            data-tab-id={tab.id}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={`relative flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              active ? "text-zinc-800" : "text-zinc-500 hover:text-zinc-700"
            }`}
          >
            {active ? (
              <motion.span
                layoutId={layoutId}
                transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 320, damping: 28 }}
                className="selection-surface absolute inset-0 rounded-xl"
              />
            ) : null}
            <span className="relative flex items-center gap-2">
              <Icon className="h-4 w-4" />
              {tab.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
