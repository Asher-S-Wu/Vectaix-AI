"use client";

import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, X } from "lucide-react";
import { useCallback, useState, useEffect } from "react";

export default function ConfirmModal({
    open,
    onClose,
    onConfirm,
    title = "确认操作",
    message = "确定要执行此操作吗？",
    confirmText = "确定",
    cancelText = "取消",
    danger = false,
}) {
    const [isProcessing, setIsProcessing] = useState(false);

    const handleConfirm = useCallback(() => {
        if (isProcessing) return;
        setIsProcessing(true);
        onConfirm();
    }, [isProcessing, onConfirm]);

    const handleCancel = useCallback(() => {
        if (isProcessing) return;
        setIsProcessing(true);
        onClose();
    }, [isProcessing, onClose]);

    useEffect(() => {
        if (!open) return;
        const timer = setTimeout(() => {
            setIsProcessing(false);
        }, 0);
        return () => clearTimeout(timer);
    }, [open]);

    // 键盘事件处理：Enter 确认，Escape 取消
    useEffect(() => {
        if (!open) return;

        const onKeyDown = (e) => {
            if (isProcessing) return;
            // 焦点在页面其他输入框（如聊天输入框）时不响应 Enter，避免误触确认
            const target = e.target;
            const isTyping = target instanceof HTMLElement
                && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
            if (e.key === 'Enter') {
                if (isTyping) return;
                e.preventDefault();
                handleConfirm();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                handleCancel();
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [open, isProcessing, handleConfirm, handleCancel]);

    return (
        <AnimatePresence>
            {open && (
                <motion.div
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
                            aria-label="关闭"
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
                                    onClick={handleCancel}
                                    disabled={isProcessing}
                                    autoFocus
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
