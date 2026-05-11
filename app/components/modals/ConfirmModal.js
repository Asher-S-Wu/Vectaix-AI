"use client";

import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, X } from "lucide-react";
import { useState, useEffect } from "react";

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

    const handleConfirm = () => {
        if (isProcessing) return;
        setIsProcessing(true);
        onConfirm();
    };

    const handleCancel = () => {
        if (isProcessing) return;
        setIsProcessing(true);
        onClose();
    };

    useEffect(() => {
        if (open) {
            setIsProcessing(false);
        }
    }, [open]);

    // 键盘事件处理：Enter 确认，Escape 取消
    useEffect(() => {
        if (!open) return;

        const onKeyDown = (e) => {
            if (isProcessing) return;
            if (e.key === 'Enter') {
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
                    className="fixed inset-0 z-50 flex items-center justify-center p-4"
                    onClick={onClose}
                >
                    <div className="absolute inset-0 bg-black/40" />
                    <motion.div
                        initial={{ scale: 0.95, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.95, opacity: 0 }}
                        onClick={(e) => e.stopPropagation()}
                        className="relative bg-white dark:bg-zinc-900 rounded-xl shadow-xl max-w-sm w-full p-6"
                    >
                        <button
                            onClick={handleCancel}
                            disabled={isProcessing}
                            className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <X size={18} />
                        </button>

                        <div className="flex flex-col items-center text-center">
                            <div
                                className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 ${danger ? "bg-red-100 dark:bg-red-900/30 text-red-500" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
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
                                    className="flex-1 px-4 py-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {cancelText}
                                </button>
                                <button
                                    onClick={handleConfirm}
                                    disabled={isProcessing}
                                    className={`flex-1 px-4 py-2.5 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${danger
                                            ? "bg-red-500 hover:bg-red-600"
                                            : "bg-zinc-600 hover:bg-zinc-500"
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
