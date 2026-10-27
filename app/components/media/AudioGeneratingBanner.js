"use client";

import { useI18n } from "@/lib/client/i18n";

import { motion, useReducedMotion } from "framer-motion";
import { Loader2 } from "lucide-react";

export default function AudioGeneratingBanner({
  title,
  description,
}) {
  const { t } = useI18n();
  title ??= t("正在合成并保存音频", "Generating and saving audio");
  description ??= t("长文本需要更多时间，请保持页面打开。", "Longer text takes more time. Keep this page open.");

  const reduceMotion = useReducedMotion();

  return (
    <motion.section
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-primary/30 bg-primary/5 p-5"
      role="status"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" />
        </span>
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-1 text-xs text-zinc-500">{description}</p>
        </div>
      </div>
    </motion.section>
  );
}
