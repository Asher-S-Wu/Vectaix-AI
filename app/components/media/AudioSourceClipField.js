"use client";
import { scopeGuestUrl } from "@/lib/client/guestAccess";


import { useEffect, useRef, useState } from "react";
import {
  CircleAlert,
  Clock3,
  FileAudio2,
  Loader2,
  Scissors,
  Trash2,
} from "lucide-react";
import {
  deleteAudioSource,
  uploadAudioSource,
} from "@/lib/media/client/media";

function roundTime(value) {
  return Math.round(Number(value) * 10) / 10;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function useObjectUrl(file) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let objectUrl = "";
    const timer = window.setTimeout(() => {
      objectUrl = URL.createObjectURL(file);
      setUrl(objectUrl);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file]);
  return url;
}

function createState(file) {
  return {
    file,
    status: "uploading",
    progress: 0,
    upload: null,
    clipStart: 0,
    clipEnd: 0,
    error: "",
  };
}

export default function AudioSourceClipField({
  file,
  purpose,
  label = "音频",
  disabled = false,
  onStateChange,
  onRemove,
}) {
  const playerRef = useRef(null);
  const onStateChangeRef = useRef(onStateChange);
  const uploadedIdRef = useRef("");
  const [state, setState] = useState(() => createState(file));
  const previewUrl = useObjectUrl(file);

  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  }, [onStateChange]);

  useEffect(() => {
    onStateChangeRef.current?.(state);
  }, [state]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    uploadedIdRef.current = "";

    uploadAudioSource(file, purpose, {
      signal: controller.signal,
      onProgress: (progress) => {
        if (!active) return;
        setState((current) => ({ ...current, progress }));
      },
    }).then((upload) => {
      if (!active) {
        deleteAudioSource(upload.fileId, { keepalive: true }).catch(() => {});
        return;
      }
      uploadedIdRef.current = upload.fileId;
      setState({
        file,
        status: "ready",
        progress: 100,
        upload,
        clipStart: 0,
        clipEnd: roundTime(Math.min(upload.duration, upload.maxClipSeconds)),
        error: "",
      });
    }).catch((error) => {
      if (!active || error?.name === "AbortError") return;
      setState({
        file,
        status: "error",
        progress: 0,
        upload: null,
        clipStart: 0,
        clipEnd: 0,
        error: error instanceof Error ? error.message : "音频上传或识别失败",
      });
    });

    return () => {
      active = false;
      controller.abort();
      const fileId = uploadedIdRef.current;
      uploadedIdRef.current = "";
      if (fileId) deleteAudioSource(fileId, { keepalive: true }).catch(() => {});
    };
  }, [file, purpose]);

  const updateClipStart = (value) => {
    setState((current) => {
      if (!current.upload) return current;
      const { duration, minClipSeconds, maxClipSeconds } = current.upload;
      let start = roundTime(clamp(value, 0, Math.max(0, duration - minClipSeconds)));
      let end = current.clipEnd;
      if (end - start < minClipSeconds) end = start + minClipSeconds;
      if (end - start > maxClipSeconds) end = start + maxClipSeconds;
      if (end > duration) {
        end = duration;
        start = Math.max(0, end - minClipSeconds);
      }
      return { ...current, clipStart: roundTime(start), clipEnd: roundTime(end) };
    });
  };

  const updateClipEnd = (value) => {
    setState((current) => {
      if (!current.upload) return current;
      const { duration, minClipSeconds, maxClipSeconds } = current.upload;
      let end = roundTime(clamp(value, minClipSeconds, duration));
      let start = current.clipStart;
      if (end - start < minClipSeconds) start = end - minClipSeconds;
      if (end - start > maxClipSeconds) start = end - maxClipSeconds;
      if (start < 0) {
        start = 0;
        end = Math.min(duration, maxClipSeconds);
      }
      return { ...current, clipStart: roundTime(start), clipEnd: roundTime(end) };
    });
  };

  const setBoundaryFromPlayer = (boundary) => {
    const currentTime = playerRef.current?.currentTime;
    if (!Number.isFinite(currentTime)) return;
    if (boundary === "start") updateClipStart(currentTime);
    else updateClipEnd(currentTime);
  };

  const upload = state.upload;
  const clipDuration = roundTime(state.clipEnd - state.clipStart);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-start gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <FileAudio2 className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-700 dark:text-zinc-200">{label} · {file.name}</p>
          <p className="mt-0.5 text-xs text-zinc-400">
            {(file.size / 1024 / 1024).toFixed(1)} MB
            {upload ? ` · ${upload.duration.toFixed(1)} 秒 · ${upload.sampleRate} Hz` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`移除${label}`}
          className="rounded-lg p-2 text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {state.status === "uploading" ? (
        <div className="mt-3 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-950/50" role="status">
          <div className="flex items-center justify-between gap-3 text-xs text-zinc-500">
            <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" />正在上传并识别音频…</span>
            <span className="tabular-nums">{state.progress}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${state.progress}%` }} />
          </div>
        </div>
      ) : null}

      {state.error ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600" role="alert">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{state.error}
        </div>
      ) : null}

      {state.status === "ready" && upload ? (
        <div className="mt-3 space-y-3">
          <p className="text-xs font-medium text-emerald-600" role="status">
            云端识别完成，提交后会自动转码
          </p>
          {previewUrl ? (
            <audio ref={playerRef} controls preload="metadata" src={scopeGuestUrl(previewUrl)} className="h-9 w-full">
              你的浏览器不支持音频播放。
            </audio>
          ) : null}

          <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-950/50">
            <div className="mb-3 flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5 font-medium text-zinc-600 dark:text-zinc-300"><Scissors className="h-3.5 w-3.5 text-primary" />选择使用片段</span>
              <span className="rounded-full bg-primary/10 px-2 py-1 font-semibold tabular-nums text-primary">{clipDuration.toFixed(1)} 秒</span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5 text-xs text-zinc-500">
                <span className="flex items-center justify-between"><span>开始时间</span><span>{state.clipStart.toFixed(1)} 秒</span></span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, upload.duration - upload.minClipSeconds)}
                  step={0.1}
                  value={state.clipStart}
                  disabled={disabled}
                  onChange={(event) => updateClipStart(event.target.value)}
                  className="w-full cursor-pointer accent-primary"
                />
                <div className="flex gap-2">
                  <input type="number" min={0} max={state.clipEnd - upload.minClipSeconds} step={0.1} value={state.clipStart} disabled={disabled} onChange={(event) => updateClipStart(event.target.value)} className="focus-ring h-8 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2 text-xs dark:border-zinc-700 dark:bg-zinc-900" />
                  <button type="button" onClick={() => setBoundaryFromPlayer("start")} disabled={disabled} className="rounded-lg border border-zinc-200 px-2 text-[11px] dark:border-zinc-700">取当前</button>
                </div>
              </label>

              <label className="space-y-1.5 text-xs text-zinc-500">
                <span className="flex items-center justify-between"><span>结束时间</span><span>{state.clipEnd.toFixed(1)} 秒</span></span>
                <input
                  type="range"
                  min={upload.minClipSeconds}
                  max={upload.duration}
                  step={0.1}
                  value={state.clipEnd}
                  disabled={disabled}
                  onChange={(event) => updateClipEnd(event.target.value)}
                  className="w-full cursor-pointer accent-primary"
                />
                <div className="flex gap-2">
                  <input type="number" min={state.clipStart + upload.minClipSeconds} max={upload.duration} step={0.1} value={state.clipEnd} disabled={disabled} onChange={(event) => updateClipEnd(event.target.value)} className="focus-ring h-8 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2 text-xs dark:border-zinc-700 dark:bg-zinc-900" />
                  <button type="button" onClick={() => setBoundaryFromPlayer("end")} disabled={disabled} className="rounded-lg border border-zinc-200 px-2 text-[11px] dark:border-zinc-700">取当前</button>
                </div>
              </label>
            </div>

            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-zinc-400">
              <Clock3 className="h-3.5 w-3.5" />允许 {upload.minClipSeconds}–{upload.maxClipSeconds} 秒，提交时会在云端转换成 16 位 PCM WAV。
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
