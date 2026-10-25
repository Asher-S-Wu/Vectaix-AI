'use client';

import { cloneElement, useId } from 'react';
import { useI18n } from '@/lib/client/i18n';
import { clientText } from '@/lib/shared/i18n.mjs';

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

export async function adminRequest(url, options) {
  const response = await fetch(url, { cache: 'no-store', ...options, ...(options?.body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || clientText('操作失败，请检查配置后重试', 'The operation failed. Check the settings and try again.'));
  return data;
}
