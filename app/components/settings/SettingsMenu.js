"use client";
import { Settings2, Globe, BookOpen, Brain } from 'lucide-react';
export default function SettingsMenu({onOpenCapabilities,webSearch,setWebSearch,ready}) {
  return <div className="ml-auto flex flex-wrap items-center gap-1">
    <button type="button" disabled={!ready} onClick={()=>setWebSearch({...webSearch,enabled:!webSearch.enabled})} aria-pressed={webSearch.enabled} title="联网搜索" className={`rounded-lg p-2 text-xs ${webSearch.enabled?'bg-primary/10 text-primary':'text-zinc-400'}`}><Globe size={16}/></button>
    {[['skills','技能',BookOpen],['memory','记忆',Brain],['general','设置',Settings2]].map(([id,label,Icon])=><button type="button" key={id} onClick={()=>onOpenCapabilities(id)} title={label} aria-label={label} className="flex items-center gap-1 rounded-lg p-2 text-xs text-zinc-500 hover:bg-primary/5 hover:text-primary"><Icon size={16}/><span className="hidden sm:inline">{label}</span></button>)}
  </div>;
}
