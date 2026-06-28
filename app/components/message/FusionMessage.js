"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  GitCompare,
  Lightbulb,
  LoaderCircle,
  Maximize2,
  Scale,
  Search,
} from "lucide-react";
import Markdown from "../common/Markdown";
import { Citations } from "./MessageListHelpers";
import { ModelGlyph } from "../common/ModelVisuals";
import { FUSION_EXPERTS, FUSION_SYNTHESIS_LABEL, FUSION_SYNTHESIS_MODEL } from "@/lib/shared/models";

const ANALYSIS_SECTIONS = [
  { key: "agreement", title: "共识点", emptyText: "暂未形成明确共识。", icon: CheckCircle2 },
  { key: "keyDifferences", title: "关键分歧", emptyText: "暂未发现关键分歧。", icon: GitCompare },
  { key: "partialCoverage", title: "覆盖不全", emptyText: "暂未发现明显覆盖缺口。", icon: Search },
  { key: "uniqueInsights", title: "独特洞察", emptyText: "暂未提炼出独特洞察。", icon: Lightbulb },
  { key: "blindSpots", title: "盲点", emptyText: "暂未发现明显盲点。", icon: AlertTriangle },
];

const FUSION_ANALYSIS_EXPORT_LABELS = {
  agreement: "共识点",
  keyDifferences: "关键分歧",
  partialCoverage: "覆盖不全",
  uniqueInsights: "独特洞察",
  blindSpots: "盲点",
};

const EXPERT_ORDER = FUSION_EXPERTS.map((expert) => expert.label);
const TERMINAL_EXPERT_STATUSES = new Set(["done", "skipped", "error"]);

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "";
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function stripMarkdownSyntax(text) {
  if (typeof text !== "string" || !text) return "";
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^#\s+/gm, "")
    .replace(/^##+\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^[*-]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractResultPreview(markdown) {
  const raw = typeof markdown === "string" ? markdown.trim() : "";
  if (!raw) {
    return { title: "正式回复", previewParagraphs: [] };
  }

  const normalized = raw.replace(/\r\n/g, "\n");
  const titleMatch = normalized.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1]?.trim() || "正式回复";
  const body = titleMatch ? normalized.replace(titleMatch[0], "").trim() : normalized;
  const previewParagraphs = stripMarkdownSyntax(body)
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 2);

  return { title, previewParagraphs };
}

function buildAnalysisExportText(analysis) {
  if (!analysis || typeof analysis !== "object") return "";
  const lines = ["# 对比分析"];

  for (const [key, title] of Object.entries(FUSION_ANALYSIS_EXPORT_LABELS)) {
    const items = Array.isArray(analysis[key]) ? analysis[key] : [];
    if (items.length === 0) continue;
    lines.push(`\n## ${title}`);
    for (const item of items) {
      const text = typeof item?.text === "string" ? item.text.trim() : "";
      if (!text) continue;
      const models = Array.isArray(item?.models) ? item.models.filter(Boolean) : [];
      const prefix = models.length > 0 ? `【${models.join(" / ")}】` : "";
      lines.push(`- ${prefix}${text}`);
    }
  }

  return lines.length > 1 ? lines.join("\n").trim() : "";
}

function buildFusionExportText(content, analysis) {
  const sections = [];
  const analysisText = buildAnalysisExportText(analysis);
  const resultText = typeof content === "string" ? content.trim() : "";

  if (analysisText) sections.push(analysisText);
  if (resultText) sections.push(resultText);

  return sections.join("\n\n").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function triggerTextDownload(text, filename) {
  if (typeof window === "undefined" || !text) return;
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function buildExpertCards(fusionExperts, fusionExpertStates) {
  const expertMap = new Map(
    (Array.isArray(fusionExperts) ? fusionExperts : [])
      .filter((expert) => expert && typeof expert === "object" && typeof expert.label === "string")
      .map((expert) => [expert.label, expert])
  );

  const stateMap = new Map(
    (Array.isArray(fusionExpertStates) ? fusionExpertStates : [])
      .filter((expert) => expert && typeof expert === "object" && typeof expert.label === "string")
      .map((expert) => [expert.label, expert])
  );

  const labels = Array.from(new Set([
    ...EXPERT_ORDER,
    ...stateMap.keys(),
    ...expertMap.keys(),
  ])).filter((label) => stateMap.has(label) || expertMap.has(label));

  return labels.map((label) => {
    const expert = expertMap.get(label) || null;
    const state = stateMap.get(label) || null;
    return {
      key: state?.key || expert?.modelId || label,
      label,
      modelId: expert?.modelId || state?.modelId || "",
      content: typeof expert?.content === "string" ? expert.content : "",
      citations: Array.isArray(expert?.citations) ? expert.citations : [],
      durationMs: Number.isFinite(expert?.durationMs) ? expert.durationMs : null,
      status: typeof state?.status === "string" ? state.status : "done",
      message: typeof state?.message === "string" ? state.message : "",
    };
  });
}

function StepHeader({ step, title }) {
  return (
    <div className="flex items-center gap-3">
      {step ? (
        <span className="inline-flex shrink-0 items-center rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-semibold tracking-[0.04em] text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
          {step}
        </span>
      ) : null}
      <span className="text-[12px] font-semibold tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
        {title}
      </span>
      <div className="h-px flex-1 bg-zinc-200/80 dark:bg-zinc-700/80" />
    </div>
  );
}

function StepState({ status = "loading", text = "" }) {
  if (status === "error") {
    return (
      <div className="flex min-h-[88px] items-center justify-center rounded-2xl border border-red-200 bg-red-50/70 px-4 py-6 text-sm text-red-600 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{text || "执行失败"}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[88px] items-center justify-center rounded-2xl border border-zinc-200 bg-white/70 px-4 py-6 text-sm text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-500">
      <div className="flex items-center gap-2">
        <LoaderCircle className="h-4 w-4 animate-spin shrink-0" />
        <span>{text || "处理中..."}</span>
      </div>
    </div>
  );
}

function ExpertCard({ expert, open, onToggle }) {
  const hasContent = Boolean(expert.content.trim());
  const durationText = formatDuration(expert.durationMs);
  const statusText = expert.status === "error"
    ? (expert.message || "执行失败")
    : expert.status === "skipped"
    ? "已跳过"
    : expert.status === "done"
    ? `已完成${durationText ? ` · ${durationText}` : ""}`
    : expert.message || "处理中";

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <button
        type="button"
        onClick={hasContent ? onToggle : undefined}
        className={`flex w-full items-center gap-3 px-4 py-4 text-left ${hasContent ? "cursor-pointer" : "cursor-default"}`}
      >
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
          <ModelGlyph model={expert.modelId} size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[18px] font-medium text-zinc-900 dark:text-zinc-100">
            {expert.label}
          </div>
          <div className={`mt-1 flex items-center gap-1.5 text-sm ${
            expert.status === "error"
              ? "text-red-500 dark:text-red-300"
              : expert.status === "done"
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-zinc-400 dark:text-zinc-500"
          }`}>
            {expert.status === "error" ? (
              <AlertTriangle className="h-4 w-4 shrink-0" />
            ) : expert.status === "done" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <LoaderCircle className="h-4 w-4 animate-spin shrink-0" />
            )}
            <span className="truncate">{statusText}</span>
          </div>
        </div>
        {hasContent ? (
          open ? <ChevronUp className="h-4 w-4 text-zinc-300 dark:text-zinc-600" /> : <ChevronDown className="h-4 w-4 text-zinc-300 dark:text-zinc-600" />
        ) : null}
      </button>

      <AnimatePresence initial={false}>
        {hasContent && open ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-zinc-100 dark:border-zinc-800"
          >
            <div className="px-5 py-4">
              <Markdown enableHighlight={true} enableMath={true}>{expert.content}</Markdown>
              <Citations citations={expert.citations} />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function AnalysisGroup({ section, items, open, onToggle }) {
  const Icon = section.icon || Scale;
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
      >
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[17px] font-medium text-zinc-900 dark:text-zinc-100">{section.title}</div>
        </div>
        <span className="text-sm font-medium text-zinc-400 dark:text-zinc-500">{items.length}</span>
        {open ? <ChevronUp className="h-4 w-4 text-zinc-300 dark:text-zinc-600" /> : <ChevronDown className="h-4 w-4 text-zinc-300 dark:text-zinc-600" />}
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-zinc-100 dark:border-zinc-800"
          >
            <div className="px-4 py-4">
              {items.length > 0 ? (
                <div className="space-y-3">
                  {items.map((item, index) => (
                    <div key={`${section.key}-${index}`} className="rounded-xl bg-zinc-50/80 px-3.5 py-3 text-sm text-zinc-700 dark:bg-zinc-950/50 dark:text-zinc-300">
                      <div className="leading-6">{item.text}</div>
                      {Array.isArray(item.models) && item.models.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {item.models.map((model) => (
                            <span
                              key={`${section.key}-${index}-${model}`}
                              className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
                            >
                              {model}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl bg-zinc-50/70 px-3.5 py-3 text-sm text-zinc-400 dark:bg-zinc-950/40 dark:text-zinc-500">
                  {section.emptyText}
                </div>
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function FusedModelStack() {
  return (
    <span className="flex -space-x-1.5">
      {FUSION_EXPERTS.map((expert) => (
        <span
          key={expert.key}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white bg-white dark:border-zinc-900 dark:bg-zinc-950"
        >
          <ModelGlyph model={expert.modelId} size={12} />
        </span>
      ))}
    </span>
  );
}

function ResultCard({ content, analysis }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef(null);
  const preview = useMemo(() => extractResultPreview(content), [content]);
  const exportText = useMemo(() => buildFusionExportText(content, analysis), [content, analysis]);

  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);

  const handleCopy = async () => {
    if (!exportText) return;
    try {
      await navigator.clipboard.writeText(exportText);
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // 复制失败时静默处理，不打断用户
    }
  };

  const handleDownload = () => {
    triggerTextDownload(exportText, "fusion-response.md");
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3.5 dark:border-zinc-800">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950">
          <ModelGlyph model={FUSION_SYNTHESIS_MODEL} size={18} />
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className="text-[17px] font-semibold text-zinc-900 dark:text-zinc-100">{FUSION_SYNTHESIS_LABEL}</span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 dark:border-zinc-700 dark:bg-zinc-950">
            <FusedModelStack />
            <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Fused</span>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={handleCopy}
            disabled={!exportText}
            title={copied ? "已复制" : "复制全文"}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 disabled:cursor-default disabled:opacity-40 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!exportText}
            title="下载为 Markdown"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 disabled:cursor-default disabled:opacity-40 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <Download className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="px-5 py-5">
        <div className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-100">
          {preview.title}
        </div>

        {expanded ? (
          <div className="mt-4">
            <Markdown enableHighlight={true} enableMath={true}>{content}</Markdown>
          </div>
        ) : (
          <div className="relative mt-4 max-h-[180px] overflow-hidden">
            <div className="space-y-3 text-[15px] leading-8 text-zinc-700 dark:text-zinc-300">
              {preview.previewParagraphs.length > 0 ? (
                preview.previewParagraphs.map((paragraph, index) => (
                  <p key={`preview-${index}`}>{paragraph}</p>
                ))
              ) : (
                <p>{stripMarkdownSyntax(content)}</p>
              )}
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-b from-transparent to-white dark:to-zinc-900" />
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-center gap-2 border-t border-zinc-100 px-4 py-3 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-50 hover:text-zinc-700 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-950 dark:hover:text-zinc-200"
      >
        <span>{expanded ? "收起完整回复" : "展开完整回复"}</span>
        <Maximize2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function FusionMessage({
  content,
  fusionExperts,
  fusionExpertStates,
  fusionAnalysis,
  fusionAnalysisState,
  fusionResultState,
}) {
  const [openExpertKey, setOpenExpertKey] = useState(null);
  const [openAnalysisKeys, setOpenAnalysisKeys] = useState(() => new Set(ANALYSIS_SECTIONS.map((section) => section.key)));

  const expertCards = useMemo(
    () => buildExpertCards(fusionExperts, fusionExpertStates),
    [fusionExperts, fusionExpertStates]
  );

  const hasSourceStage = expertCards.length > 0 || (Array.isArray(fusionExpertStates) && fusionExpertStates.length > 0);
  const hasAnalysisStage = Boolean(fusionAnalysis) || Boolean(fusionAnalysisState);
  const isDirectResultOnly = !hasSourceStage && !hasAnalysisStage;
  const sourceReady = expertCards.length > 0 && expertCards.every((expert) => TERMINAL_EXPERT_STATUSES.has(expert.status));
  const sourceError = expertCards.find((expert) => expert.status === "error") || null;
  const analysisReady = Boolean(fusionAnalysis);
  const analysisError = fusionAnalysisState?.status === "error" ? fusionAnalysisState?.message || "分析失败" : "";
  const resultReady = typeof content === "string" && content.trim().length > 0;
  const resultError = fusionResultState?.status === "error" ? fusionResultState?.message || "结果生成失败" : "";

  const toggleAnalysisKey = (key) => {
    setOpenAnalysisKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (isDirectResultOnly) {
    return (
      <div className="w-full space-y-4">
        <StepHeader title="正式回复" />
        {resultReady ? (
          <ResultCard content={content} analysis={fusionAnalysis} />
        ) : (
          <StepState
            status={resultError ? "error" : "loading"}
            text={resultError || fusionResultState?.message || "正在整理正式回复..."}
          />
        )}
      </div>
    );
  }

  return (
    <div className="w-full space-y-5">
      <div className="space-y-3">
        <StepHeader step="步骤 1/3" title="来源" />
        {sourceReady ? (
          <div className="space-y-3">
            {expertCards.map((expert) => (
              <ExpertCard
                key={expert.key}
                expert={expert}
                open={openExpertKey === expert.key}
                onToggle={() => setOpenExpertKey((current) => current === expert.key ? null : expert.key)}
              />
            ))}
          </div>
        ) : (
          <StepState
            status={sourceError ? "error" : "loading"}
            text={sourceError ? sourceError.message || "来源阶段执行失败" : "正在等待三位专家完成..."}
          />
        )}
      </div>

      {(sourceReady || analysisReady || fusionAnalysisState) ? (
        <div className="space-y-3">
          <StepHeader step="步骤 2/3" title="对比分析" />
          {analysisReady ? (
            <div className="space-y-3">
              {ANALYSIS_SECTIONS.map((section) => {
                const items = Array.isArray(fusionAnalysis?.[section.key]) ? fusionAnalysis[section.key] : [];
                return (
                  <AnalysisGroup
                    key={section.key}
                    section={section}
                    items={items}
                    open={openAnalysisKeys.has(section.key)}
                    onToggle={() => toggleAnalysisKey(section.key)}
                  />
                );
              })}
            </div>
          ) : (
            <StepState
              status={analysisError ? "error" : "loading"}
              text={analysisError || fusionAnalysisState?.message || "正在汇总三位专家的异同点..."}
            />
          )}
        </div>
      ) : null}

      {(analysisReady || resultReady || fusionResultState) ? (
        <div className="space-y-3">
          <StepHeader step="步骤 3/3" title="正式回复" />
          {resultReady ? (
            <ResultCard content={content} analysis={fusionAnalysis} />
          ) : (
            <StepState
              status={resultError ? "error" : "loading"}
              text={resultError || fusionResultState?.message || "正在整理正式回复..."}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
