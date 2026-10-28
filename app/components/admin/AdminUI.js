'use client';

import { cloneElement, useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useI18n } from '@/lib/client/i18n';
import { apiJson } from '@/lib/client/apiClient';

export function AdminConfigSection({ title, description, summary, icon: Icon, defaultOpen = false, children }) {
  const titleId = useId();
  const [open, setOpen] = useState(defaultOpen);

  return <details className="admin-config-section" open={open} onToggle={event => setOpen(event.currentTarget.open)} onInvalid={event => {
    event.currentTarget.open = true;
    setOpen(true);
  }}>
    <summary className="admin-config-trigger" aria-labelledby={titleId}>
      <Icon size={20} className="admin-config-icon" aria-hidden="true" />
      <div className="admin-config-heading"><h2 id={titleId}>{title}</h2><p>{description}</p></div>
      <span className="admin-config-preview">{summary}</span>
      <ChevronDown size={18} className="admin-config-chevron" aria-hidden="true" />
    </summary>
    <div className="admin-config-content">{children}</div>
  </details>;
}

export function AdminField({ label, hint, children, ...props }) {
  const id = useId();
  const inputProps = { id, ...(hint ? { 'aria-describedby': `${id}-hint` } : {}) };
  return <div className="admin-field"><label htmlFor={id}>{label}</label>{children ? cloneElement(children, inputProps) : <input {...inputProps} {...props} />}{hint && <small id={`${id}-hint`}>{hint}</small>}</div>;
}

export function AdminNotice({ error, notice }) {
  const { t, localizeMessage, formatNumber } = useI18n();
  const message = value => Array.isArray(value) ? t(value[0], value[1], Object.fromEntries(Object.entries(value[2] || {}).map(([key, item]) => [key, typeof item === "number" ? formatNumber(item) : item]))) : localizeMessage(value);
  return <>{error && <p role="alert" className="admin-notice admin-error">{message(error)}</p>}{notice && <p role="status" className="admin-notice">{message(notice)}</p>}</>;
}

export function adminRequest(url, options) {
  return apiJson(url, { cache: 'no-store', ...options });
}
