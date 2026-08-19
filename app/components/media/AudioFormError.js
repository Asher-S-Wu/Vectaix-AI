import { CircleAlert } from "lucide-react";

export default function AudioFormError({ message, className = "" }) {
  if (!message) return null;
  return (
    <div
      className={`flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 ${className}`}
      role="alert"
    >
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
