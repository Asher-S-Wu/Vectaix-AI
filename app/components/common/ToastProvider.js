"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, CheckCircle, Info, AlertTriangle, X } from "lucide-react";

const ToastContext = createContext(null);

const TOAST_TYPES = {
  success: {
    icon: CheckCircle,
    bg: "toast-success",
    iconColor: "text-emerald-500",
  },
  error: {
    icon: AlertCircle,
    bg: "toast-error",
    iconColor: "text-red-500",
  },
  warning: {
    icon: AlertTriangle,
    bg: "toast-warning",
    iconColor: "text-amber-500",
  },
  info: {
    icon: Info,
    bg: "toast-info",
    iconColor: "text-blue-500",
  },
};

const DEFAULT_DURATION = 4000;
const MAX_TOASTS = 3;

let toastIdCounter = 0;

function ToastItem({ toast, onDismiss }) {
  const config = TOAST_TYPES[toast.type] || TOAST_TYPES.info;
  const Icon = config.icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -40, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className={`
        flex items-center gap-2.5 px-4 py-2.5 rounded-full border shadow-lg backdrop-blur-sm
        ${config.bg}
        max-w-[90vw] sm:max-w-md
      `}
    >
      <Icon size={18} className={`flex-shrink-0 ${config.iconColor}`} />
      <span className="toast-text text-sm font-medium break-words line-clamp-2">
        {toast.message}
      </span>
      <button
        onClick={() => onDismiss(toast.id)}
        className="toast-close flex-shrink-0 p-0.5 rounded-full transition-colors"
      >
        <X size={14} />
      </button>
    </motion.div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((type, message, duration = DEFAULT_DURATION) => {
    const id = ++toastIdCounter;
    const newToast = { id, type, message, duration };

    setToasts((prev) => {
      const trimmed = prev.slice(-(MAX_TOASTS - 1));
      return [...trimmed, newToast];
    });

    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }

    return id;
  }, []);

  const toast = {
    success: (message, duration) => addToast("success", message, duration),
    error: (message, duration) => addToast("error", message, duration),
    warning: (message, duration) => addToast("warning", message, duration),
    info: (message, duration) => addToast("info", message, duration),
    dismiss,
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div
        className="fixed z-[9999] top-0 left-0 right-0 flex flex-col items-center gap-2 pointer-events-none"
        style={{ paddingTop: "max(env(safe-area-inset-top, 12px), 12px)" }}
      >
        <AnimatePresence mode="popLayout">
          {toasts.map((t) => (
            <div key={t.id} className="pointer-events-auto">
              <ToastItem toast={t} onDismiss={dismiss} />
            </div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}
