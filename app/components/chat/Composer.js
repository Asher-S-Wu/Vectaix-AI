"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Square } from "lucide-react";

export default function Composer({ loading, isStreaming, isWaitingForAI, onSend, onStop }) {
  const [input, setInput] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef(null);
  const canStop = isStreaming || isWaitingForAI;

  useEffect(() => {
    const setAppHeight = () => {
      const viewport = window.visualViewport;
      document.documentElement.style.setProperty("--app-height", isFocused ? `${Math.round(viewport?.height ?? window.innerHeight)}px` : "100dvh");
      document.documentElement.style.setProperty("--app-offset-top", isFocused ? `${Math.round(viewport?.offsetTop ?? 0)}px` : "0px");
    };
    setAppHeight();
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", setAppHeight);
    viewport?.addEventListener("scroll", setAppHeight);
    window.addEventListener("resize", setAppHeight);
    return () => {
      viewport?.removeEventListener("resize", setAppHeight);
      viewport?.removeEventListener("scroll", setAppHeight);
      window.removeEventListener("resize", setAppHeight);
    };
  }, [isFocused]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const height = textarea.scrollHeight;
    textarea.style.height = `${Math.min(height, 160)}px`;
    textarea.style.overflowY = height > 160 ? "auto" : "hidden";
  }, [input]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const sent = await onSend({ text });
    if (sent === true) setInput(current => current.trim() === text ? "" : current);
  };

  const handleKeyDown = event => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey && !/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="max-w-4xl mx-auto w-full relative">
      <div className="composer-shell relative flex items-end gap-2 p-3 md:p-4 glass-effect rounded-[24px] border-zinc-200/60 dark:border-zinc-800/60 hover:border-zinc-300 dark:hover:border-zinc-700">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={event => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          aria-label="消息"
          placeholder="给 AI 发送消息…"
          className="flex-1 min-w-0 bg-transparent border-none outline-none focus:ring-0 text-base md:text-[15px] text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 resize-none py-2 min-h-[44px] transition-all no-scrollbar"
          rows={1}
        />
        <button
          onClick={canStop ? onStop : handleSend}
          disabled={!canStop && (loading || !input.trim())}
          className={`mb-0.5 flex shrink-0 items-center justify-center w-9 h-9 rounded-full transition-all duration-200 active:scale-90 disabled:cursor-not-allowed ${canStop
            ? "bg-red-500 hover:bg-red-600 text-white shadow-soft"
            : "btn-primary disabled:bg-zinc-200 dark:disabled:bg-zinc-800 disabled:text-zinc-400 dark:disabled:text-zinc-600 disabled:shadow-none"}`}
          type="button"
          aria-label={canStop ? "停止生成" : "发送"}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={canStop ? "stop" : "send"}
              initial={{ scale: 0.4, opacity: 0, rotate: -90 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              exit={{ scale: 0.4, opacity: 0, rotate: 90 }}
              transition={{ duration: 0.15 }}
              className="flex items-center justify-center"
            >
              {canStop ? <Square size={18} fill="currentColor" /> : <ArrowUp size={18} strokeWidth={2.5} />}
            </motion.span>
          </AnimatePresence>
        </button>
      </div>
    </div>
  );
}
