"use client";

import { cloneElement, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '@/lib/client/i18n';
import { apiJson } from '@/lib/client/apiClient';

export const inputClass = 'w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 dark:border-zinc-700 dark:bg-zinc-900';
export function Section({ title, description, children }) { return <section className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6 dark:border-zinc-800 dark:bg-zinc-900/40"><div><h2 className="text-base font-semibold tracking-tight">{title}</h2>{description && <p className="mt-1.5 text-sm leading-6 text-zinc-500">{description}</p>}</div>{children}</section>; }
export function Field({ label, hint, children, ...props }) {
  const generatedId = useId();
  const id = props.id || children?.props.id || generatedId;
  const inputProps = { id, ...(hint ? { 'aria-describedby': `${id}-hint` } : {}) };
  return <div className="block space-y-2 text-sm"><label htmlFor={id} className="block font-medium">{label}</label>{children ? cloneElement(children, inputProps) : <input className={inputClass} {...props} {...inputProps} />}{hint && <span id={`${id}-hint`} className="block text-xs leading-5 text-zinc-500">{hint}</span>}</div>;
}
export function FileInput({ className = '', onChange, disabled, ...props }) {
  const { t } = useI18n();
  const [filename, setFilename] = useState('');
  return <span className={`relative flex min-w-0 items-center gap-3 focus-within:ring-2 focus-within:ring-primary/20 ${disabled ? 'opacity-50' : ''} ${className}`}>
    <span className="shrink-0 rounded-lg bg-zinc-100 px-3 py-1 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">{t('选择文件', 'Choose file')}</span>
    <span className="truncate text-zinc-500">{filename || t('未选择文件', 'No file selected')}</span>
    <input {...props} type="file" disabled={disabled} className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed" onChange={event => { setFilename(event.target.files[0]?.name || ''); onChange?.(event); event.currentTarget.value = ''; }} />
  </span>;
}
export function Toggle({ label, description, checked, onChange, disabled }) { return <label className="flex items-center justify-between gap-5 py-2 text-sm"><span><span className="block font-medium">{label}</span>{description && <span className="mt-1 block text-xs leading-5 text-zinc-500">{description}</span>}</span><input className="h-5 w-5 shrink-0 accent-primary" role="switch" type="checkbox" checked={checked === true} onChange={event => onChange(event.target.checked)} disabled={disabled} /></label>; }
export function Action({ children, primary, danger, className = '', ...props }) { return <button type="button" className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-wait disabled:opacity-50 ${primary ? 'bg-primary text-white hover:bg-primary/90' : danger ? 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-950/30' : 'border border-zinc-200 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800'} ${className}`} {...props}>{children}</button>; }
export function ErrorNotice({ error }) { const { localizeMessage } = useI18n(); return error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{localizeMessage(error)}</p> : null; }
export function PanelState({ panel }) {
  const { t } = useI18n();
  if (panel.data) return null;
  return panel.error ? <Action disabled={panel.busy} onClick={() => panel.run(panel.reload)}>{t('重新加载', 'Reload')}</Action> : <p role="status" className="text-sm text-zinc-500">{t('正在加载设置…', 'Loading settings…')}</p>;
}
export function usePanelData(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const reload = useCallback(async () => { const result = await apiJson(path); setData(result); setError(''); return result; }, [path]);
  useEffect(() => { let disposed = false; apiJson(path).then(result => { if (!disposed) setData(result); }).catch(failure => { if (!disposed) setError(failure.message); }); return () => { disposed = true; }; }, [path]);
  const run = async action => { if (running.current) return null; running.current = true; setBusy(true); setError(''); try { return await action(); } catch (failure) { setError(failure.message); return null; } finally { running.current = false; setBusy(false); } };
  return { data, setData, error, setError, busy, run, reload };
}
export function downloadText(name, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
