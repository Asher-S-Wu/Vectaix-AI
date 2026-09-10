"use client";
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Mic, Square, Camera, ClipboardPaste, MapPin, LoaderCircle, Plus, X } from 'lucide-react';
import { useToast } from '../common/ToastProvider';
import { useCredits } from '@/lib/client/credits/CreditContext';

export default function DeviceActions({permissions,onText,onFiles,onSettings,disabled}) {
  const toast = useToast(), {refreshCredit} = useCredits();
  const recorder = useRef(null), stream = useRef(null), timer = useRef(null), request = useRef(null), camera = useRef(null), cameraStream = useRef(null);
  const [showCamera,setShowCamera] = useState(false), [cameraReady,setCameraReady] = useState(false);
  useEffect(()=>{ if(showCamera && camera.current) camera.current.srcObject = cameraStream.current; },[showCamera]);
  const [recording,setRecording] = useState(false), [busy,setBusy] = useState(false), [expanded,setExpanded] = useState(false);
  useEffect(()=>()=>{if (recorder.current?.state === 'recording') { recorder.current.onstop = null; recorder.current.stop(); } stream.current?.getTracks().forEach(track=>track.stop()); cameraStream.current?.getTracks().forEach(track=>track.stop()); clearTimeout(timer.current); request.current?.abort();},[]);
  const permitted = key => { if (permissions?.[key] === true) return true; toast.error('请先在权限与安全中开启这项功能'); onSettings('permissions'); return false; };
  const stop = () => { if (recorder.current?.state === 'recording') recorder.current.stop(); };
  const record = async () => {
    if (recording) { stop(); return; }
    if (!permitted('microphone')) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast.error('当前浏览器不支持录音'); return; }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({audio:true});
      const instance = new MediaRecorder(stream.current); recorder.current = instance;
      const chunks = [];
      instance.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      instance.onerror = () => { stream.current?.getTracks().forEach(track=>track.stop()); setRecording(false); toast.error('录音失败，请检查麦克风'); };
      instance.onstop = async () => {
        clearTimeout(timer.current); stream.current?.getTracks().forEach(track=>track.stop()); setRecording(false); setBusy(true);
        const controller = new AbortController(); request.current = controller;
        try {
          const file = new File(chunks,'录音.webm',{type:instance.mimeType});
          const body = new FormData(); body.set('file',file);
          const response = await fetch('/api/voice/transcribe',{method:'POST',body,headers:{'x-credit-operation-id':crypto.randomUUID()},signal:controller.signal});
          const data = await response.json(); if (!response.ok) throw new Error(data.error);
          onText(data.text); toast.success('录音已转为文字，可编辑后发送');
          await refreshCredit();
        } catch(error) { if (error.name !== 'AbortError') toast.error(error.message); }
        finally { request.current = null; setBusy(false); }
      };
      instance.start(); setRecording(true); timer.current = setTimeout(stop,10*60000);
    } catch(error) { stream.current?.getTracks().forEach(track=>track.stop()); toast.error(error.name === 'NotAllowedError' ? '麦克风权限已被拒绝' : '无法开始录音'); }
  };
  const closeCamera = () => { cameraStream.current?.getTracks().forEach(track=>track.stop()); cameraStream.current = null; setShowCamera(false); setCameraReady(false); };
  const openCamera = async () => {
    if (!permitted('camera')) return;
    if (!navigator.mediaDevices?.getUserMedia) {toast.error('当前浏览器不支持相机');return;}
    try { cameraStream.current = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}}); setShowCamera(true); setExpanded(false); }
    catch(error) {toast.error(error.name==='NotAllowedError'?'相机权限已被拒绝':'无法打开相机');}
  };
  const capture = async () => {
    if (!camera.current?.videoWidth) return;
    const canvas = document.createElement('canvas'); canvas.width = camera.current.videoWidth; canvas.height = camera.current.videoHeight;
    canvas.getContext('2d').drawImage(camera.current,0,0);
    const blob = await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.92));
    if (!blob) {toast.error('拍照失败');return;}
    closeCamera(); await onFiles({target:{files:[new File([blob],`拍照-${Date.now()}.jpg`,{type:'image/jpeg'})]}});
  };
  const clipboard = async () => { if (!permitted('clipboard')) return; if (!navigator.clipboard?.readText) {toast.error('当前浏览器不支持读取剪贴板');return;} try {onText(await navigator.clipboard.readText());setExpanded(false);} catch {toast.error('未获得剪贴板读取权限');} };
  const location = () => { if (!permitted('geolocation')) return; if (!navigator.geolocation) {toast.error('当前浏览器不支持定位');return;} navigator.geolocation.getCurrentPosition(value=>{onText(`我的位置：纬度 ${value.coords.latitude.toFixed(6)}，经度 ${value.coords.longitude.toFixed(6)}（误差约 ${Math.round(value.coords.accuracy)} 米）`);setExpanded(false);},()=>toast.error('未能获取位置，请检查定位权限'),{timeout:10000,maximumAge:0}); };
  return <div className="relative flex items-center gap-1">
    {showCamera && createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-label="拍照上传"><div className="w-full max-w-xl space-y-4 rounded-2xl bg-white p-4 dark:bg-zinc-900"><div className="flex items-center justify-between"><h2 className="font-semibold">拍照上传</h2><button type="button" aria-label="关闭相机" onClick={closeCamera}><X size={20}/></button></div><video ref={camera} autoPlay muted playsInline onLoadedMetadata={()=>setCameraReady(true)} className="aspect-video w-full rounded-xl bg-black object-contain"/><button type="button" disabled={!cameraReady} onClick={capture} className="w-full rounded-xl bg-primary py-3 text-white disabled:opacity-50">拍照并添加附件</button></div></div>,document.body)}
    <button type="button" disabled={disabled || busy} onClick={record} aria-label={recording?'停止录音并转文字':'录音输入'} title={recording?'停止录音并转文字':'录音输入'} className={`rounded-lg p-2 ${recording?'bg-red-50 text-red-500':'text-zinc-500 hover:text-primary'} disabled:opacity-40`}>{busy?<LoaderCircle size={17} className="animate-spin"/>:recording?<Square size={17}/>:<Mic size={17}/>}</button>
    {recording && <span className="text-xs text-red-500">正在录音</span>}
    <button type="button" aria-label="更多输入方式" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)} className="rounded-lg p-2 text-zinc-500 hover:text-primary">{expanded?<X size={17}/>:<Plus size={17}/>}</button>
    {expanded && <div className="absolute bottom-full left-0 z-30 mb-2 w-44 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
      <button type="button" disabled={disabled} onClick={openCamera} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-zinc-600 hover:bg-primary/5 dark:text-zinc-300"><Camera size={16}/>拍照上传</button>
      <button type="button" disabled={disabled} onClick={clipboard} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-zinc-600 hover:bg-primary/5 dark:text-zinc-300"><ClipboardPaste size={16}/>读取剪贴板</button>
      <button type="button" disabled={disabled} onClick={location} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-zinc-600 hover:bg-primary/5 dark:text-zinc-300"><MapPin size={16}/>添加当前位置</button>
    </div>}
  </div>;
}
