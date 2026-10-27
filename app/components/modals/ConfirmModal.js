"use client";

import { useI18n } from '@/lib/client/i18n';
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useCallback, useId, useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export default function ConfirmModal({
    open,
    onClose,
    onConfirm,
    title,
    message,
    confirmText,
    cancelText,
    danger = false,
}) {
  const { t } = useI18n();
    title ??= t('确认操作', 'Confirm action');
    message ??= t('确定要执行此操作吗？', 'Continue with this action?');
    confirmText ??= t('确定', 'Confirm');
    cancelText ??= t('取消', 'Cancel');

    const [isProcessing, setIsProcessing] = useState(false);
    const dialogRef = useRef(null);
    const cancelRef = useRef(null);
    const titleId = useId();
    const messageId = useId();

    const handleConfirm = useCallback(async () => {
        if (isProcessing) return;
        setIsProcessing(true);
        try { await onConfirm(); }
        finally { setIsProcessing(false); }
    }, [isProcessing, onConfirm]);

    const handleCancel = useCallback(() => {
        if (isProcessing) return;
        onClose();
    }, [isProcessing, onClose]);

    useEffect(() => {
        if (!open) return;
        const previousFocus = document.activeElement;
        cancelRef.current?.focus();
        return () => {
            if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
        };
    }, [open]);

    useEffect(() => {
        if (!open) return;

        const onKeyDown = (e) => {
            if (isProcessing) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                handleCancel();
            } else if (e.key === 'Tab') {
                const buttons = [...dialogRef.current.querySelectorAll('button:not(:disabled)')];
                const first = buttons[0], last = buttons.at(-1);
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault(); last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault(); first.focus();
                }
            }
        };

        const dialog = dialogRef.current;
        dialog.addEventListener('keydown', onKeyDown);
        return () => dialog.removeEventListener('keydown', onKeyDown);
    }, [open, isProcessing, handleCancel]);

    if (typeof document === "undefined") return null;
    return createPortal(
        <AnimatePresence>
            {open && (
                <motion.div
                    ref={dialogRef}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[70] flex items-center justify-center p-4"
                    onClick={handleCancel}
                    role={danger ? "alertdialog" : "dialog"}
                    aria-modal="true"
                    aria-labelledby={titleId}
                    aria-describedby={messageId}
                >
                    <div className="absolute inset-0 bg-black/40" />
                    <motion.div
                        initial={{ scale: 0.95, opacity: 0, y: 8 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.95, opacity: 0, y: 8 }}
                        transition={{ duration: 0.18 }}
                        onClick={(e) => e.stopPropagation()}
                        className="relative bg-white rounded-2xl shadow-pop border border-zinc-200 dark:border-zinc-700 max-w-sm w-full p-6"
                    >
                        <div className="flex items-start gap-3">
                            {danger && <span aria-hidden="true" className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-500">
                                <AlertTriangle size={18} />
                            </span>}
                            <div className="min-w-0">
                                <h2 id={titleId} className="text-base font-semibold text-zinc-800">
                                    {title}
                                </h2>
                                <p id={messageId} className="mt-2 text-sm leading-relaxed text-zinc-600 break-words">{message}</p>
                            </div>
                        </div>

                        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                            <button
                                type="button"
                                ref={cancelRef}
                                onClick={handleCancel}
                                disabled={isProcessing}
                                className="min-h-10 px-4 py-2 text-sm font-medium text-zinc-700 bg-zinc-100 hover:bg-zinc-200 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {cancelText}
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirm}
                                disabled={isProcessing}
                                className={`inline-flex min-h-10 items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-xl transition-colors disabled:opacity-60 disabled:cursor-wait ${danger
                                        ? "bg-red-600 text-white hover:bg-red-700"
                                        : "btn-primary"
                                    }`}
                            >
                                {isProcessing && <Loader2 size={15} className="animate-spin motion-reduce:animate-none" />}
                                {confirmText}
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>,
        document.body,
    );
}
