"use client";

import { useI18n } from "@/lib/client/i18n";
import { useState } from 'react';
import { apiJson } from '@/lib/client/apiClient';

export default function ApplyGlobalMediaButton({ section, value, disabled=false, onBusyChange }) {
  const { t, localizeMessage } = useI18n();

  const [busy,setBusy]=useState(false);
  const [savedSelection,setSavedSelection]=useState('');
  const [error,setError]=useState('');
  const selection=JSON.stringify({section,value});
  const notice=savedSelection===selection ? t("已保存为全平台媒体默认参数", "Saved as the media defaults for all users") : '';
  async function save() {
    setBusy(true);onBusyChange?.(true);setSavedSelection('');setError('');
    try {
      await apiJson('/api/admin/media',{method:'PUT',body:{[section]:value,...(['audio','qwenAudio'].includes(section)?{audioProvider:value.provider}:{})}});
      setSavedSelection(selection);
    } catch(error) {setError(error.message);} finally {setBusy(false);onBusyChange?.(false);}
  }
  return <div className="space-y-2">
    <button type="button" disabled={disabled||busy} onClick={save} className="text-sm font-medium text-primary disabled:opacity-50">{busy?t("正在保存…", "Saving…"):t("设为全平台默认参数", "Set as default for all users")}</button>
    {notice&&<p role="status" className="text-xs text-zinc-500">{notice}</p>}
    {error&&<p role="alert" className="text-xs text-red-500">{localizeMessage(error)}</p>}
  </div>;
}
