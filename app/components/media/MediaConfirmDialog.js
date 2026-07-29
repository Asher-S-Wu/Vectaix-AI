"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, X } from "lucide-react";

export default function MediaConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = "确认",
  cancelText = "取消",
  danger = false,
}) {
  const reduceMotion = useReducedMotion();
  const dialogRef = useRef(null);
  const cancelButtonRef = useRef(null);
  const previousFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const onConfirmRef = useRef(onConfirm);
  const confirmingRef = useRef(false);

  useEffect(() => {
    onCloseRef.current = onClose;
    onConfirmRef.current = onConfirm;
  }, [onClose, onConfirm]);

  useEffect(() => {
    if (!open) return undefined;

    previousFocusRef.current = document.activeElement;
    confirmingRef.current = false;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => cancelButtonRef.current?.focus(), 0);

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key === "Tab") {
        const focusable = Array.from(dialogRef.current?.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) || []).filter((element) => element.getAttribute("aria-hidden") !== "true");
        if (focusable.length === 0) {
          event.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (!dialogRef.current?.contains(active)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        } else if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus?.();
    };
  }, [open]);

  const handleConfirm = () => {
    if (confirmingRef.current) return;
    confirmingRef.current = true;
    onConfirmRef.current();
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button
            type="button"
            onClick={() => onCloseRef.current()}
            className="absolute inset-0 cursor-default bg-zinc-950/45 backdrop-blur-sm"
            aria-label="关闭确认窗口"
            tabIndex={-1}
          />
          <motion.section
            ref={dialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="media-confirm-title"
            aria-describedby="media-confirm-description"
            initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-sm rounded-[24px] border border-zinc-200 bg-white p-6 shadow-pop dark:border-zinc-800 dark:bg-zinc-950"
          >
            <button
              type="button"
              onClick={() => onCloseRef.current()}
              className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              aria-label="关闭"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex flex-col items-center text-center">
              <span className={`flex h-12 w-12 items-center justify-center rounded-full ${danger ? "bg-red-100 text-red-500 dark:bg-red-950/40 dark:text-red-300" : "bg-primary/10 text-primary"}`}>
                <AlertTriangle className="h-6 w-6" />
              </span>
              <h2 id="media-confirm-title" className="mt-4 pr-1 text-lg font-semibold">{title}</h2>
              <p id="media-confirm-description" className="mt-2 text-sm leading-6 text-zinc-500">{message}</p>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                ref={cancelButtonRef}
                type="button"
                onClick={() => onCloseRef.current()}
                className="h-11 rounded-xl bg-zinc-100 text-sm font-medium text-zinc-700 transition-[background-color,transform] hover:bg-zinc-200 active:scale-[0.98] dark:bg-zinc-800 dark:text-zinc-200"
              >
                {cancelText}
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                className={`h-11 rounded-xl text-sm font-medium text-white transition-[background-color,transform] active:scale-[0.98] ${
                  danger ? "bg-red-500 hover:bg-red-600" : "bg-primary hover:bg-primary/90 dark:text-sky-950"
                }`}
              >
                {confirmText}
              </button>
            </div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
