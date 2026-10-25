"use client";

import { CircleAlert } from "lucide-react";
import { useI18n } from "@/lib/client/i18n";

export default function AudioFormError({ message, className = "" }) {
  const { localizeMessage } = useI18n();
  if (!message) return null;
  return (
    <div
      className={`flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300 ${className}`}
      role="alert"
    >
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{localizeMessage(message)}</span>
    </div>
  );
}
