"use client";

import { useI18n } from '@/lib/client/i18n';
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, X } from "lucide-react";
import { useCallback, useState, useEffect, useRef } from "react";

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

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    ref={dialogRef}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[70] flex items-center justify-center p-4"
                    onClick={handleCancel}
                    role="dialog"
                    aria-modal="true"
                    aria-label={title}
                >
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
                    <motion.div
                        initial={{ scale: 0.95, opacity: 0, y: 8 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.95, opacity: 0, y: 8 }}
                        transition={{ duration: 0.18 }}
                        onClick={(e) => e.stopPropagation()}
                        className="relative bg-white dark:bg-zinc-900 rounded-2xl shadow-pop border border-zinc-200 dark:border-zinc-700 max-w-sm w-full p-6"
                    >
                        <button
                            onClick={handleCancel}
                            disabled={isProcessing}
                            aria-label={t("关闭", "Close")}
                            className="absolute top-4 right-4 p-1 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <X size={18} />
                        </button>

                        <div className="flex flex-col items-center text-center">
                            <div
                                className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 ${danger ? "bg-red-100 text-red-500" : "bg-zinc-100 text-zinc-600 dark:text-zinc-400"
                                    }`}
                            >
                                <AlertTriangle size={24} />
                            </div>

                            <h3 className="text-lg font-semibold text-zinc-800 dark:text-zinc-100 mb-2">
                                {title}
                            </h3>
                            <p className="text-sm text-zinc-500 mb-6">{message}</p>

                            <div className="flex gap-3 w-full">
                                <button
                                    ref={cancelRef}
                                    onClick={handleCancel}
                                    disabled={isProcessing}
                                    className="flex-1 px-4 py-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 bg-zinc-100 hover:bg-zinc-200 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {cancelText}
                                </button>
                                <button
                                    onClick={handleConfirm}
                                    disabled={isProcessing}
                                    className={`flex-1 px-4 py-2.5 text-sm font-medium text-white rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${danger
                                            ? "bg-red-500 hover:bg-red-600"
                                            : "bg-primary hover:bg-primary/90"
                                        }`}
                                >
                                    {confirmText}
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
