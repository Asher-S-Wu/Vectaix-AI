"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Loader2 } from "lucide-react";

export default function AudioGeneratingBanner({
  title = "正在合成并保存音频",
  description = "长文本需要更多时间，请保持页面打开。",
}) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.section
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-effect rounded-2xl border border-primary/20 p-5"
      aria-live="polite"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" />
        </span>
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-1 text-xs text-zinc-500">{description}</p>
        </div>
      </div>
      <div className="mt-4 h-11 animate-pulse rounded-xl bg-primary/10 motion-reduce:animate-none" aria-hidden="true" />
    </motion.section>
  );
}
