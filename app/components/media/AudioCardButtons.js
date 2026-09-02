import { Download, Loader2, Trash2 } from "lucide-react";

export function AudioDownloadButton({ href, fileName, className = "" }) {
  return (
    <a
      href={href}
      download={fileName}
      className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-sm font-medium text-zinc-700 transition-[background-color,transform] hover:bg-zinc-100 active:scale-[0.98] dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800 ${className}`}
    >
      <Download className="h-4 w-4" />
      下载
    </a>
  );
}

export function AudioDeleteButton({ deleting = false, disabled = false, onClick, label, title = "删除", className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={deleting || disabled}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 transition-[background-color,color,transform] hover:border-red-200 hover:bg-red-50 hover:text-red-600 active:scale-[0.98] disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 ${className}`}
      aria-label={label}
      title={title}
    >
      {deleting ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Trash2 className="h-4 w-4" />}
    </button>
  );
}
