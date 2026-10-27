"use client";

import { useEffect, useState } from "react";
import { apiJson } from "@/lib/client/apiClient";
import { useI18n } from "@/lib/client/i18n";

export default function MonthlyUsage({ tasks, onOpenUsage }) {
  const { t, formatNumber } = useI18n();
  const [usage, setUsage] = useState(null);
  const [failed, setFailed] = useState(false);
  const refreshKey = JSON.stringify(tasks?.map(task => [task._id, task.status, task.costCny, task.billingReviewRequired]));

  useEffect(() => {
    let controller;
    let timer;
    async function refresh() {
      if (document.visibilityState !== "visible") return;
      controller?.abort();
      const request = new AbortController();
      controller = request;
      try {
        const result = await apiJson("/api/usage/current-month", { signal: request.signal, cache: "no-store" });
        if (request.signal.aborted) return;
        setUsage(result);
        setFailed(false);
      } catch {
        if (request.signal.aborted) return;
        setFailed(true);
        clearInterval(timer);
      }
    }
    // Keep background task charges and month changes current while the page is visible.
    timer = setInterval(refresh, 60000);
    void refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refreshKey]);

  const pending = !failed && usage?.unpricedRequests > 0;
  const allPending = pending && usage.unpricedRequests === usage.requests;
  const amount = failed ? t("暂不可用", "Unavailable") : !usage ? "—" : allPending ? t("待核查", "Under review") : formatNumber(usage.costCny, { style: "currency", currency: "CNY", minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const description = failed
    ? t("本月花费读取失败，点击查看账单。", "Could not load this month's spending. Select to view billing.")
    : t("按北京时间自然月累计，点击查看账单。", "Monthly total based on Beijing time. Select to view billing.") + (pending ? t("{count} 次调用费用待核查，暂未计入金额。", " {count} requests are under review and excluded from this total.", { count: formatNumber(usage.unpricedRequests) }) : "");

  return (
    <button
      type="button"
      onClick={onOpenUsage}
      aria-label={pending ? t("本月花费 {amount}，部分费用待核查，查看账单", "This month's spending: {amount}. Some charges are under review. View billing", { amount }) : t("本月花费 {amount}，查看账单", "This month's spending: {amount}. View billing", { amount })}
      title={description}
      className="group ml-1 flex min-w-[76px] shrink-0 flex-col items-end justify-center gap-0.5 rounded-lg py-1 pl-2 pr-1.5 text-right transition-colors hover:bg-primary/10 sm:ml-1.5 sm:min-w-[96px] sm:pl-3 sm:pr-2"
    >
      <span className="flex items-center gap-1 text-[11px] leading-4 text-zinc-500">
        {t("本月花费", "This month")}
        {pending && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
      </span>
      <span aria-live="polite" aria-atomic="true" className={`whitespace-nowrap text-sm font-semibold leading-5 tabular-nums sm:text-base ${failed || allPending ? "text-zinc-500" : "text-zinc-800 group-hover:text-primary"}`}>
        {amount}
      </span>
    </button>
  );
}
