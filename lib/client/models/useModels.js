'use client';
import { useEffect, useSyncExternalStore } from 'react';
import { installModelCatalog } from '@/lib/shared/models';
const listeners=new Set();
const initial={models:[],defaultModelId:null,loading:true,error:null};
let snapshot=initial;
let inflight=null;
function notify() { for (const listener of listeners) listener(); }
export async function loadModels() {
  if (inflight) return inflight;
  inflight=(async()=>{
    try {
      const response=await fetch('/api/models',{cache:'no-store'});
      const data=await response.json();
      if (!response.ok) throw new Error(data.error || '读取模型失败');
      installModelCatalog(data);
      snapshot={...data,loading:false,error:null};notify();
      return snapshot;
    } catch(error) { snapshot={...snapshot,loading:false,error:error.message};notify();throw error; }
    finally { inflight=null; }
  })();
  return inflight;
}
function subscribe(listener) { listeners.add(listener);return ()=>listeners.delete(listener); }
export function useModels() {
  const result=useSyncExternalStore(subscribe,()=>snapshot,()=>initial);
  useEffect(()=>{loadModels().catch(()=>{});},[]);
  return result;
}
