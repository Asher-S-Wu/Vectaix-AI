"use client";
import { useState } from 'react';
import { apiJson } from '@/lib/client/apiClient';

export default function UseInChatButton({ section, value, disabled=false }) {
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  async function save() {
    setBusy(true);setNotice('');setError('');
    try {
      const {settings}=await apiJson('/api/settings');
      await apiJson('/api/settings',{method:'PUT',body:{chatMediaSettings:{...settings.chatMediaSettings,[section]:value}}});
      setNotice(section==='audio'?'对话配音和朗读已使用当前配置':'对话创作已使用当前配置');
    } catch(error) {setError(error.message);} finally {setBusy(false);}
  }
  return <div className="space-y-2">
    <button type="button" disabled={disabled||busy} onClick={save} className="text-sm font-medium text-primary disabled:opacity-50">{busy?'正在保存…':section==='audio'?'用于对话配音和朗读':'用于对话创作'}</button>
    {notice&&<p role="status" className="text-xs text-zinc-500">{notice}</p>}
    {error&&<p role="alert" className="text-xs text-red-500">{error}</p>}
  </div>;
}
