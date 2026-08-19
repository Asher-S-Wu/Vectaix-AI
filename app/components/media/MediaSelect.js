"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";

const PANEL_MAX_HEIGHT = 240;
const VIEWPORT_GAP = 8;

export default function MediaSelect({
  id,
  value,
  onChange,
  options,
  disabled = false,
  size = "md",
  ariaLabel,
}) {
  const reduceMotion = useReducedMotion();
  const listboxId = useId();
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);

  const selected = options.find((option) => option.id === value) || null;

  const openPanel = () => {
    if (disabled) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_GAP;
      const spaceAbove = rect.top - VIEWPORT_GAP;
      const placement = spaceBelow >= Math.min(PANEL_MAX_HEIGHT, 180) || spaceBelow >= spaceAbove
        ? "bottom"
        : "top";
      setPosition({
        left: rect.left,
        width: rect.width,
        placement,
        ...(placement === "bottom"
          ? { top: rect.bottom + 6 }
          : { bottom: window.innerHeight - rect.top + 6 }),
      });
    }
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return undefined;

    const focusTimer = window.setTimeout(() => {
      const target = panelRef.current?.querySelector('[aria-selected="true"]:not([disabled])')
        || panelRef.current?.querySelector('[role="option"]:not([disabled])');
      target?.focus();
    }, 0);

    const handlePointerDown = (event) => {
      if (triggerRef.current?.contains(event.target) || panelRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const handleScroll = (event) => {
      if (panelRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const handleResize = () => setOpen(false);

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleResize);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
    };
  }, [open]);

  const handleTriggerKeyDown = (event) => {
    if (disabled) return;
    if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      if (!open) openPanel();
    }
  };

  const handlePanelKeyDown = (event) => {
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) return;
    event.preventDefault();
    const buttons = Array.from(
      panelRef.current?.querySelectorAll('[role="option"]:not([disabled])') || [],
    );
    if (buttons.length === 0) return;
    if (event.key === "Enter" || event.key === " ") {
      document.activeElement?.click();
      return;
    }
    const currentIndex = buttons.indexOf(document.activeElement);
    let nextIndex = currentIndex;
    if (event.key === "ArrowDown") nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % buttons.length;
    if (event.key === "ArrowUp") nextIndex = currentIndex <= 0 ? buttons.length - 1 : currentIndex - 1;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = buttons.length - 1;
    buttons[nextIndex]?.focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openPanel())}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        className={`focus-ring flex ${size === "lg" ? "h-11" : "h-10"} w-full items-center justify-between gap-2 rounded-xl border bg-white px-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-900 ${
          open
            ? "border-primary dark:border-primary"
            : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600"
        }`}
      >
        <span className="truncate">{selected?.label ?? "请选择"}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
      </button>

      {open && position ? createPortal(
        <AnimatePresence>
          <motion.ul
            ref={panelRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            initial={reduceMotion ? false : { opacity: 0, scale: 0.97, y: position.placement === "bottom" ? -4 : 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: position.placement === "bottom" ? -4 : 4 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            style={{
              position: "fixed",
              left: position.left,
              width: position.width,
              maxHeight: PANEL_MAX_HEIGHT,
              transformOrigin: position.placement === "bottom" ? "top" : "bottom",
              ...(position.placement === "bottom"
                ? { top: position.top }
                : { bottom: position.bottom }),
            }}
            className="fade-scrollbar z-[80] overflow-y-auto overscroll-contain rounded-xl border border-zinc-200 bg-white p-1 shadow-pop dark:border-zinc-700 dark:bg-zinc-900"
            onKeyDown={handlePanelKeyDown}
          >
            {options.map((option, index) => {
              const isSelected = option.id === value;
              return (
                <li key={String(option.id) || `option-${index}`} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={Boolean(option.disabled)}
                    tabIndex={-1}
                    onClick={() => {
                      onChange(option.id);
                      setOpen(false);
                      triggerRef.current?.focus();
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      isSelected
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    }`}
                  >
                    <span className="truncate">{option.label}</span>
                    {isSelected ? <Check className="h-4 w-4 shrink-0" /> : null}
                  </button>
                </li>
              );
            })}
          </motion.ul>
        </AnimatePresence>,
        document.body,
      ) : null}
    </>
  );
}
