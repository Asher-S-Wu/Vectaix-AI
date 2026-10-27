'use client';

import { cloneElement, useId } from 'react';
import { useI18n } from '@/lib/client/i18n';
import { apiJson } from '@/lib/client/apiClient';

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
