"use client";

import { useI18n } from "@/lib/client/i18n";

import Image from "next/image";
import TaskApprovals from "./TaskApprovals";
import { Check, Circle, Download, FileText, LoaderCircle, OctagonX } from "lucide-react";

const ACTIVE = new Set(["queued", "running", "waiting_media", "waiting_approval"]);

export default function TaskDelivery({ message, task }) {
  const { t, formatNumber, localizeMessage } = useI18n();
  const LABELS = { queued: t("正在排队", "Queued"), running: t("正在处理", "Working"), waiting_media: t("正在生成素材", "Generating media"), waiting_approval: t("等待你的确认", "Waiting for your approval"), completed: t("已完成", "Completed"), failed: t("执行失败", "Failed"), stopped: t("已停止", "Stopped"), interrupted: t("执行已中断", "Interrupted") };
  const status = task?.status || message.taskStatus;
  const active = ACTIVE.has(status);
  const artifacts = task?.artifacts || message.artifacts || [];
  const error = task?.error;
  const plan = task?.plan || message.plan || [];
  return (
    <div className="my-2 w-full max-w-2xl space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        {active ? <LoaderCircle size={13} className="animate-spin" /> : status === "completed" ? <Check size={13} /> : <OctagonX size={13} />}
        <span>{task?.stopRequested && active ? t("正在停止", "Stopping") : LABELS[status]}</span>
      </div>
      {plan.length > 0 && <details className="task-plan" open={active}><summary>{t("执行计划 · {done}/{total} 已完成", "Plan · {done}/{total} completed", { done: formatNumber(plan.filter(step => step.status === "completed").length), total: formatNumber(plan.length) })}</summary><ol>{plan.map(step => <li key={step.id} data-status={step.status}>{step.status === 'completed' ? <Check size={14} className="shrink-0" /> : step.status === 'in_progress' ? <LoaderCircle size={14} className="shrink-0 animate-spin" /> : <Circle size={13} className="shrink-0" />}<span>{step.title}</span></li>)}</ol></details>}
      {status === "waiting_approval" && <TaskApprovals taskId={String(message.taskId)} />}
      {error && <p className="text-sm text-red-500">{localizeMessage(error)}</p>}
      {["failed", "interrupted", "stopped"].includes(status) && <p className="text-xs text-zinc-500">{t("可以继续发送消息，或点击下方“重新生成”重试。", "Send another message or select Regenerate below to try again.")}</p>}
      {artifacts.length > 0 && <div className="grid gap-2 sm:grid-cols-2">
        {artifacts.map(file => <div key={file.fileId} className="overflow-hidden rounded-xl border border-zinc-200/70 dark:border-zinc-700">
          {file.mimeType?.startsWith("image/") && <a href={file.url} target="_blank" rel="noreferrer"><Image src={file.url} alt={file.name} width={600} height={450} unoptimized className="h-auto w-full" /></a>}
          {file.mimeType?.startsWith("audio/") && <audio src={file.url} controls preload="metadata" className="w-full" />}
          {file.mimeType?.startsWith("video/") && <video src={file.url} controls preload="metadata" className="w-full" />}
          <a href={`/api/files/${file.fileId}?download=1`} className="flex min-w-0 items-center gap-3 rounded-xl border border-zinc-200/70 bg-zinc-50/50 p-3 hover:border-primary/40 dark:border-zinc-700 dark:bg-zinc-800/40">
          <FileText size={20} className="shrink-0 text-primary" />
          <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{file.name || file.originalName}</div><div className="mt-0.5 text-[11px] uppercase text-zinc-500">{file.extension || file.category}</div></div>
          <Download size={15} className="shrink-0 text-zinc-400" />
        </a></div>)}
      </div>}
    </div>
  );
}
