"use client";

import { Coins } from "lucide-react";
import { useCredits } from "@/lib/client/credits/CreditContext";

const numberFormatter = new Intl.NumberFormat("zh-CN");

export default function CreditBadge({ className = "" }) {
  const { credit, loading, openCreditHistory } = useCredits();
  if (!credit && !loading) return null;

  const label = credit?.unlimited
    ? "无限积分"
    : numberFormatter.format(credit?.availablePoints || 0);
  const displayLabel = credit?.unlimited ? label : `${label} 积分`;
  const held = credit?.heldPoints || 0;
  const title = credit?.unlimited
    ? "超级管理员无限积分，点击查看使用记录"
    : held > 0
      ? `剩余 ${label} 积分，另有 ${numberFormatter.format(held)} 积分冻结中`
      : `剩余 ${label} 积分`;

  return (
    <button
      type="button"
      onClick={openCreditHistory}
      disabled={!credit}
      aria-label={title}
      title={title}
      className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-2.5 text-xs font-semibold text-amber-800 shadow-sm transition-colors hover:bg-amber-100 disabled:cursor-wait disabled:opacity-60 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/70 ${className}`}
    >
      <Coins size={15} aria-hidden="true" />
      <span>{credit ? displayLabel : "…"}</span>
      {held > 0 ? (
        <span className="font-normal text-amber-600 dark:text-amber-300">
          · 冻结 {numberFormatter.format(held)}
        </span>
      ) : null}
    </button>
  );
}
