"use client";

import { useEffect, useState } from "react";
import { apiJson } from "@/lib/client/apiClient";

const money = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

export default function MonthlyUsage({ tasks, onOpenUsage }) {
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
  const amount = failed ? "暂不可用" : !usage ? "—" : allPending ? "待核查" : `¥${money.format(usage.costCny)}`;
  const description = failed
    ? "月度消耗暂时无法读取，点击查看账单"
    : `按北京时间自然月累计，点击查看账单${pending ? `；${usage.unpricedRequests} 次调用费用待核查，暂未计入金额` : ""}`;

  return (
    <button
      type="button"
      onClick={onOpenUsage}
      aria-label={`本月消耗 ${amount}${pending ? "，部分费用待核查" : ""}，查看账单`}
      title={description}
      className="group ml-1 flex min-w-[76px] shrink-0 flex-col items-end justify-center gap-0.5 rounded-r-lg border-l border-zinc-200/80 py-1 pl-2 pr-1 text-right transition-colors hover:bg-sky-50/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-500 sm:ml-2 sm:min-w-[100px] sm:pl-4 sm:pr-2 dark:border-zinc-700/70 dark:hover:bg-sky-950/30"
    >
      <span className="flex items-center gap-1 text-[10px] leading-4 text-zinc-500 sm:text-[11px] dark:text-zinc-400">
        本月消耗
        {pending && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
      </span>
      <span aria-live="polite" aria-atomic="true" className={`whitespace-nowrap text-sm font-semibold leading-5 tabular-nums sm:text-base ${failed || allPending ? "text-zinc-500 dark:text-zinc-400" : "text-zinc-800 group-hover:text-sky-600 dark:text-zinc-100 dark:group-hover:text-sky-400"}`}>
        {amount}
      </span>
    </button>
  );
}
