"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

export const fieldClass = "w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2.5 text-sm text-zinc-800 dark:text-zinc-100 focus:outline-none focus:border-primary";
export const buttonClass = "inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50";

export default function ChatSettingsDialog({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => { ref.current.showModal(); }, []);
  return <dialog ref={ref} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }} className="m-auto w-[calc(100%-2rem)] max-w-xl max-h-[85dvh] overflow-y-auto rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100 p-0 shadow-2xl backdrop:bg-black/40 backdrop:backdrop-blur-sm"><div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-5 py-4"><h2 className="font-semibold">{title}</h2><button type="button" onClick={onClose} aria-label="关闭" className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"><X size={18} /></button></div><div className="p-5 space-y-4">{children}</div></dialog>;
}

export function SettingsFields({ fields, onSubmit, busy, onCancel, submitText = "保存" }) {
  const [values, setValues] = useState(() => Object.fromEntries(fields.map(field => [field.name, field.value ?? ""])));
  return <form className="space-y-4" onSubmit={event => { event.preventDefault(); onSubmit(Object.fromEntries(new FormData(event.currentTarget))); }}>
    {fields.filter(field => !field.when || field.when(values)).map(field => <label key={field.name} className="block space-y-1.5"><span className="text-sm font-medium">{field.label}</span>{field.type === "select" ? <select name={field.name} className={fieldClass} value={values[field.name]} onChange={event => setValues(current => ({ ...current, [field.name]: event.target.value }))}>{(typeof field.options === "function" ? field.options(values) : field.options).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : field.multiline ? <textarea className={fieldClass} name={field.name} defaultValue={field.value} rows={field.rows || 4} required={field.required} maxLength={field.maxLength} /> : <input className={fieldClass} name={field.name} type={field.type || "text"} defaultValue={field.value} required={field.required || field.type === "number"} min={field.min} max={field.max} step={field.step} maxLength={field.maxLength} />}{field.hint && <span className="block text-xs leading-relaxed text-zinc-500">{field.hint}</span>}</label>)}
    <div className="flex justify-end gap-2 pt-2"><button type="button" className={buttonClass} onClick={onCancel}>取消</button><button disabled={busy} className="rounded-xl bg-primary px-5 py-2 text-sm text-white disabled:opacity-50">{busy ? "处理中…" : submitText}</button></div>
  </form>;
}

export function SettingsToggle({ checked, label, onChange, disabled }) {
  return <label className="flex items-center justify-between gap-3 text-sm font-medium"><span>{label}</span><input type="checkbox" role="switch" className="h-4 w-4 accent-primary" checked={checked} onChange={onChange} disabled={disabled} /></label>;
}
