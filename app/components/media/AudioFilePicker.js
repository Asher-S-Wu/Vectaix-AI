"use client";

import { Upload } from "lucide-react";

export default function AudioFilePicker({
  id,
  inputKey,
  onChange,
  compact = false,
  disabled = false,
  accept,
  title = "选择声音样本",
  hint = "常见音频格式，最大 100MB、最长 30 分钟",
}) {
  return (
    <label
      htmlFor={id}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/70 px-4 text-center transition-[border-color,background-color,transform] hover:border-primary/60 hover:bg-primary/[0.03] focus-within:border-primary focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900/60 ${
        compact ? "min-h-[112px] py-4" : "min-h-[148px] py-5"
      }`}
    >
      <span className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Upload className="h-5 w-5" />
      </span>
      <span className="max-w-full truncate text-sm font-medium text-zinc-700 dark:text-zinc-200">
        {title}
      </span>
      <span className="mt-1 text-xs text-zinc-500">
        {hint}
      </span>
      <input
        key={inputKey}
        id={id}
        type="file"
        accept={accept}
        disabled={disabled}
        className="sr-only"
        onChange={(event) => {
          const selected = event.target.files?.[0] || null;
          event.target.value = "";
          onChange(selected);
        }}
      />
    </label>
  );
}
