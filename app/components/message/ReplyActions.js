"use client";

import { useI18n } from "@/lib/client/i18n";
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Volume2, Square, Share2, LoaderCircle } from 'lucide-react';
import { useToast } from '../common/ToastProvider';
import { apiJson } from '@/lib/client/apiClient';

const subscribeNothing = () => () => {};

export default function ReplyActions({text}) {
  const { t, localizeMessage } = useI18n();
  const toast = useToast();
  const player = useRef(null), request = useRef(null);
  const [state,setState] = useState('idle');
  const canShare = useSyncExternalStore(subscribeNothing, () => typeof navigator.share === 'function', () => false);
  useEffect(()=>()=>{player.current?.pause();request.current?.abort();},[]);
  const speak = async () => {
    if (state !== 'idle') { request.current?.abort(); player.current?.pause(); setState('idle'); return; }
    setState('loading'); const controller = new AbortController(); request.current = controller;
    try {
      const data = await apiJson('/api/voice/speak',{method:'POST',body:{text},headers:{'x-credit-operation-id':crypto.randomUUID()},signal:controller.signal});
      if (controller.signal.aborted) return;
      const audio = new Audio(data.audioUrl); player.current = audio;
      audio.onended = ()=>setState('idle'); audio.onerror = ()=>{setState('idle');toast.error(["音频播放失败", "Audio playback failed"]);};
      await audio.play(); setState('playing');
    } catch(error) {setState('idle');if(error.name !== 'AbortError') toast.error(localizeMessage(error.message));}
    finally { request.current = null; }
  };
  const share = async () => { try { await navigator.share({title:t("花卷回复", "Huajuan reply"),text}); } catch(error) {if(error.name !== 'AbortError')toast.error(["分享未完成", "Sharing was canceled or failed"]);} };
  return <><button type="button" onClick={speak} title={state==='idle'?t("朗读回复", "Read aloud"):t("停止朗读", "Stop reading")} aria-label={state==='idle'?t("朗读回复", "Read aloud"):t("停止朗读", "Stop reading")} className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-primary/10 hover:text-primary">{state==='loading'?<LoaderCircle size={16} className="animate-spin motion-reduce:animate-none"/>:state==='playing'?<Square size={16}/>:<Volume2 size={16}/>}</button>{canShare && <button type="button" onClick={share} title={t("分享回复", "Share reply")} aria-label={t("分享回复", "Share reply")} className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-primary/10 hover:text-primary"><Share2 size={16}/></button>}</>;
}
