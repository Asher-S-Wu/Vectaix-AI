"use client";

import { useI18n } from "@/lib/client/i18n";

import Select from '@/app/components/common/Select';
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

export const fieldClass = "w-full min-w-0 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white px-3 py-2.5 text-sm text-zinc-800 outline-none transition-colors placeholder:text-zinc-400 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60";
export const buttonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white px-3 py-2 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50";

export default function ChatSettingsDialog({ title, onClose, children, busy = false }) {
  const { t } = useI18n();
  const ref = useRef(null);
  const pressedBackdrop = useRef(false);
  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  return <dialog ref={ref} aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onPointerDown={event => { pressedBackdrop.current = event.target === event.currentTarget; }} onClick={event => { if (!busy && pressedBackdrop.current && event.target === event.currentTarget) onClose(); pressedBackdrop.current = false; }} className="m-auto w-[calc(100%-2rem)] max-w-xl max-h-[85dvh] overflow-y-auto rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white text-zinc-800 p-0 shadow-pop backdrop:bg-black/40"><div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-zinc-100 bg-white px-5 py-4"><h2 className="min-w-0 break-words font-semibold">{title}</h2><button type="button" disabled={busy} onClick={onClose} aria-label={t("关闭", "Close")} className="shrink-0 rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-50"><X size={18} /></button></div><div className="p-5 space-y-4">{children}</div></dialog>;
}

export function SettingsFields({ fields, onSubmit, busy, onCancel, submitText }) {
  const { t } = useI18n();
  const [values, setValues] = useState(() => Object.fromEntries(fields.map(field => [field.name, field.value ?? ""])));
  const update = (name, value) => setValues(current => ({ ...current, [name]: value }));
  return <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (!busy) onSubmit(Object.fromEntries(new FormData(event.currentTarget))); }}>
    {fields.filter(field => !field.when || field.when(values)).map(field => <label key={field.name} className="block space-y-1.5"><span className="text-sm font-medium">{field.label}</span>{field.type === "select" ? <Select name={field.name} className={fieldClass} value={values[field.name]} onChange={value => update(field.name, value)} options={[...(typeof field.options === "function" ? field.options(values) : field.options).map(option => ({
  id: option.value,
  label: option.label
}))]} /> : field.multiline ? <textarea className={fieldClass} name={field.name} defaultValue={field.value} onChange={event => update(field.name, event.target.value)} rows={field.rows || 4} required={field.required} maxLength={field.maxLength} /> : <input className={fieldClass} name={field.name} type={field.type || "text"} defaultValue={field.value} onChange={event => update(field.name, event.target.value)} required={field.required || field.type === "number"} min={field.min} max={field.max} step={field.step} maxLength={field.maxLength} />}{field.hint && <span className="block text-xs leading-relaxed text-zinc-500">{field.hint}</span>}</label>)}
    <div className="flex justify-end gap-2 pt-2"><button type="button" disabled={busy} className={buttonClass} onClick={onCancel}>{t("取消", "Cancel")}</button><button type="submit" disabled={busy} className="btn-primary min-h-10 rounded-xl px-5 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50">{busy ? t("处理中…", "Working…") : (submitText || t("保存", "Save"))}</button></div>
  </form>;
}
