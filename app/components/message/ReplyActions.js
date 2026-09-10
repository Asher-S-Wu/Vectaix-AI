"use client";
import { useEffect, useRef, useState } from 'react';
import { Volume2, Square, Share2, LoaderCircle } from 'lucide-react';
import { useToast } from '../common/ToastProvider';
import { useCredits } from '@/lib/client/credits/CreditContext';
import { apiJson } from '@/lib/client/apiClient';

export default function ReplyActions({text}) {
  const toast = useToast(), {refreshCredit} = useCredits();
  const player = useRef(null), request = useRef(null);
  const [state,setState] = useState('idle');
  useEffect(()=>()=>{player.current?.pause();request.current?.abort();},[]);
  const speak = async () => {
    if (state !== 'idle') { request.current?.abort(); player.current?.pause(); setState('idle'); return; }
    setState('loading'); const controller = new AbortController(); request.current = controller;
    try {
      const data = await apiJson('/api/voice/speak',{method:'POST',body:{text},headers:{'x-credit-operation-id':crypto.randomUUID()},signal:controller.signal});
      if (controller.signal.aborted) return;
      const audio = new Audio(data.audioUrl); player.current = audio;
      audio.onended = ()=>setState('idle'); audio.onerror = ()=>{setState('idle');toast.error('音频播放失败');};
      await audio.play(); setState('playing'); await refreshCredit();
    } catch(error) {setState('idle');if(error.name !== 'AbortError') toast.error(error.message);}
    finally { request.current = null; }
  };
  const share = async () => { if (!navigator.share) {toast.error('当前浏览器不支持系统分享');return;} try { await navigator.share({title:'Vectaix 回复',text}); } catch(error) {if(error.name !== 'AbortError')toast.error('分享未完成');} };
  return <><button type="button" onClick={speak} title={state==='idle'?'朗读回复（使用积分）':'停止朗读'} aria-label={state==='idle'?'朗读回复':'停止朗读'} className="rounded-lg p-2 text-zinc-400 hover:bg-primary/5 hover:text-primary">{state==='loading'?<LoaderCircle size={16} className="animate-spin"/>:state==='playing'?<Square size={16}/>:<Volume2 size={16}/>}</button><button type="button" onClick={share} title="分享回复" aria-label="分享回复" className="rounded-lg p-2 text-zinc-400 hover:bg-primary/5 hover:text-primary"><Share2 size={16}/></button></>;
}
