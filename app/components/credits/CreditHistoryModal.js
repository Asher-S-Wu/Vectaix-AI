"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Coins, Loader2, X } from "lucide-react";
import { apiJson } from "@/lib/client/apiClient";
import { useCredits } from "@/lib/client/credits/CreditContext";

const numberFormatter = new Intl.NumberFormat("zh-CN");

const TYPE_LABELS = Object.freeze({
  registration_grant: "注册赠送",
  admin_set: "管理员调整",
  model_usage: "模型消费",
});

const STATUS_LABELS = Object.freeze({
  pending: "等待处理",
  reserved: "积分冻结中",
  settling: "正在结算",
  settled: "已结算",
  released: "已退回",
  review_required: "待管理员核对",
  rejected: "未执行",
});

function transactionTitle(item) {
  if (item?.type === "model_usage") {
    return item.model || item.feature || "模型使用";
  }
  return TYPE_LABELS[item?.type] || "积分变动";
}

function signedPoints(item) {
  const delta = Number(item?.deltaPoints);
  if (Number.isInteger(delta)) return delta;
  if (item?.type === "admin_set" || item?.type === "registration_grant") {
    return Number(item?.chargedPoints) || 0;
  }
  const charged = Number(item?.chargedPoints) || 0;
  const refunded = Number(item?.refundedPoints) || 0;
  return refunded - charged;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function CreditHistoryDialog({ credit, onClose }) {
  const [transactions, setTransactions] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const closeButtonRef = useRef(null);

  const load = useCallback(async ({ cursor = null, append = false } = {}) => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ limit: "20" });
      if (cursor) query.set("cursor", cursor);
      const payload = await apiJson(`/api/credits/transactions?${query}`, { cache: "no-store" });
      const items = Array.isArray(payload?.transactions) ? payload.transactions : [];
      setTransactions((current) => append ? [...current, ...items] : items);
      setNextCursor(typeof payload?.nextCursor === "string" ? payload.nextCursor : null);
    } catch (loadError) {
      setError(loadError?.message || "积分明细加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => load(), 0);
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(loadTimer);
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [load, onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/45 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="credit-history-title"
        className="max-h-[86dvh] w-full overflow-hidden rounded-t-3xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950 sm:max-w-lg sm:rounded-3xl"
      >
        <header className="flex items-start justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <div>
            <div className="flex items-center gap-2">
              <Coins size={18} className="text-amber-600 dark:text-amber-300" aria-hidden="true" />
              <h2 id="credit-history-title" className="font-semibold text-zinc-900 dark:text-zinc-100">积分明细</h2>
            </div>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {credit?.unlimited
                ? "超级管理员无限积分"
                : `可用 ${numberFormatter.format(credit?.availablePoints || 0)} · 冻结 ${numberFormatter.format(credit?.heldPoints || 0)}`}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="关闭积分明细"
            className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <X size={18} />
          </button>
        </header>

        <div className="max-h-[65dvh] overflow-y-auto px-4 py-3 sm:px-5">
          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300">
              <p>{error}</p>
              <button type="button" onClick={() => load()} className="mt-3 font-medium underline">重新加载</button>
            </div>
          ) : null}

          {!error && !loading && transactions.length === 0 ? (
            <div className="py-14 text-center text-sm text-zinc-500 dark:text-zinc-400">暂无积分记录</div>
          ) : null}

          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {transactions.map((item) => {
              const delta = signedPoints(item);
              return (
                <article key={item.id} className="flex items-start justify-between gap-4 py-3.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">{transactionTitle(item)}</p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      {STATUS_LABELS[item.status] || "已记录"}
                      {Number(item.refundedPoints) > 0 ? ` · 退回 ${numberFormatter.format(Number(item.refundedPoints))}` : ""}
                      {item.type !== "model_usage" && item.reason ? ` · ${item.reason}` : ""}
                    </p>
                    <time className="mt-1 block text-xs text-zinc-400">{formatDate(item.createdAt)}</time>
                  </div>
                  <span className={`shrink-0 text-sm font-semibold ${delta > 0 ? "text-emerald-600 dark:text-emerald-400" : delta < 0 ? "text-red-600 dark:text-red-400" : "text-zinc-500"}`}>
                    {delta > 0 ? "+" : ""}{numberFormatter.format(delta)}
                  </span>
                </article>
              );
            })}
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-5 text-sm text-zinc-500">
              <Loader2 size={16} className="animate-spin" aria-hidden="true" /> 加载中…
            </div>
          ) : null}

          {!loading && nextCursor ? (
            <button
              type="button"
              onClick={() => load({ cursor: nextCursor, append: true })}
              className="mt-3 w-full rounded-xl border border-zinc-200 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              加载更多
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export default function CreditHistoryModal() {
  const { credit, historyOpen, closeCreditHistory } = useCredits();
  return historyOpen ? (
    <CreditHistoryDialog credit={credit} onClose={closeCreditHistory} />
  ) : null;
}
