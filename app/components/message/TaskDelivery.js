"use client";

import Image from "next/image";
import TaskApprovals from "./TaskApprovals";
import { Check, Download, FileText, LoaderCircle, OctagonX } from "lucide-react";

const LABELS = { queued: "正在排队", running: "正在处理", waiting_media: "正在生成素材", waiting_approval: "等待你的确认", completed: "已完成", failed: "执行失败", stopped: "已停止", interrupted: "执行已中断" };
const ACTIVE = new Set(["queued", "running", "waiting_media", "waiting_approval"]);

export default function TaskDelivery({ message, task, limits }) {
  const status = task?.status || message.taskStatus;
  const active = ACTIVE.has(status);
  const artifacts = task?.artifacts || message.artifacts || [];
  const points = task?.chargedPoints ?? message.chargedPoints;
  const error = task?.error;
  return (
    <div className="my-2 w-full max-w-2xl space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        {active ? <LoaderCircle size={13} className="animate-spin" /> : status === "completed" ? <Check size={13} /> : <OctagonX size={13} />}
        <span>{task?.stopRequested && active ? "正在停止" : LABELS[status]}</span>
        {typeof points === "number" && <span>· 已消耗 {points.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 积分</span>}
        {task?.billingReviewRequired && <span>· 部分用量待核查</span>}
      </div>
      {active && limits && <p className="text-[11px] text-zinc-400">每次执行最多 {limits.maxSteps} 个步骤、{limits.maxMinutes} 分钟；每人同时执行 {limits.perUserConcurrency} 项。关闭页面后仍会继续。</p>}
      {status === "waiting_approval" && <TaskApprovals taskId={String(message.taskId)} />}
      {error && <p className="text-sm text-red-500">{error}</p>}
      {["failed", "interrupted", "stopped"].includes(status) && <p className="text-xs text-zinc-500">可以继续发送消息，或使用下方重新生成按钮发起新的执行。</p>}
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
