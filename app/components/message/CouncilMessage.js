"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileText,
  LoaderCircle,
  Scale,
} from "lucide-react";
import Markdown from "../common/Markdown";
import { Citations } from "./MessageListHelpers";
import { ModelGlyph } from "../common/ModelVisuals";
import { COUNCIL_EXPERTS, SEED_MODEL_ID } from "@/lib/shared/models";

const ANALYSIS_SECTIONS = [
  { key: "agreement", title: "共识点", emptyText: "暂未形成明确共识。" },
  { key: "keyDifferences", title: "关键分歧", emptyText: "暂未发现关键分歧。" },
  { key: "partialCoverage", title: "覆盖不全", emptyText: "暂未发现明显覆盖缺口。" },
  { key: "uniqueInsights", title: "独特洞察", emptyText: "暂未提炼出独特洞察。" },
  { key: "blindSpots", title: "盲点", emptyText: "暂未发现明显盲点。" },
];

const EXPERT_ORDER = COUNCIL_EXPERTS.map((expert) => expert.label);
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

function buildExpertCards(councilExperts, councilExpertStates) {
  const expertMap = new Map(
    (Array.isArray(councilExperts) ? councilExperts : [])
      .filter((expert) => expert && typeof expert === "object" && typeof expert.label === "string")
      .map((expert) => [expert.label, expert])
  );

  const stateMap = new Map(
    (Array.isArray(councilExpertStates) ? councilExpertStates : [])
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
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
      >
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400">
          <Scale className="h-4 w-4" />
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

function ResultCard({ content }) {
  const [expanded, setExpanded] = useState(false);
  const preview = useMemo(() => extractResultPreview(content), [content]);

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-4 dark:border-zinc-800">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950">
          <ModelGlyph model={SEED_MODEL_ID} size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[18px] font-semibold text-zinc-900 dark:text-zinc-100">Seed</div>
          <div className="mt-1 text-sm text-zinc-400 dark:text-zinc-500">正式回复</div>
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
          <div className="mt-4 space-y-3 text-[15px] leading-8 text-zinc-700 dark:text-zinc-300">
            {preview.previewParagraphs.length > 0 ? (
              preview.previewParagraphs.map((paragraph, index) => (
                <p key={`preview-${index}`}>{paragraph}</p>
              ))
            ) : (
              <p>{stripMarkdownSyntax(content)}</p>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-center gap-2 border-t border-zinc-100 px-4 py-3 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-50 hover:text-zinc-700 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-950 dark:hover:text-zinc-200"
      >
        <FileText className="h-4 w-4" />
        <span>{expanded ? "收起完整回复" : "展开完整回复"}</span>
      </button>
    </div>
  );
}

export default function CouncilMessage({
  content,
  councilExperts,
  councilExpertStates,
  councilAnalysis,
  councilAnalysisState,
  councilResultState,
}) {
  const [openExpertKey, setOpenExpertKey] = useState(null);
  const [openAnalysisKeys, setOpenAnalysisKeys] = useState(() => new Set(ANALYSIS_SECTIONS.map((section) => section.key)));

  const expertCards = useMemo(
    () => buildExpertCards(councilExperts, councilExpertStates),
    [councilExperts, councilExpertStates]
  );

  const hasSourceStage = expertCards.length > 0 || (Array.isArray(councilExpertStates) && councilExpertStates.length > 0);
  const hasAnalysisStage = Boolean(councilAnalysis) || Boolean(councilAnalysisState);
  const isDirectResultOnly = !hasSourceStage && !hasAnalysisStage;
  const sourceReady = expertCards.length > 0 && expertCards.every((expert) => TERMINAL_EXPERT_STATUSES.has(expert.status));
  const sourceError = expertCards.find((expert) => expert.status === "error") || null;
  const analysisReady = Boolean(councilAnalysis);
  const analysisError = councilAnalysisState?.status === "error" ? councilAnalysisState?.message || "分析失败" : "";
  const resultReady = typeof content === "string" && content.trim().length > 0;
  const resultError = councilResultState?.status === "error" ? councilResultState?.message || "结果生成失败" : "";

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
          <ResultCard content={content} />
        ) : (
          <StepState
            status={resultError ? "error" : "loading"}
            text={resultError || councilResultState?.message || "正在整理正式回复..."}
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

      {(sourceReady || analysisReady || councilAnalysisState) ? (
        <div className="space-y-3">
          <StepHeader step="步骤 2/3" title="对比分析" />
          {analysisReady ? (
            <div className="space-y-3">
              {ANALYSIS_SECTIONS.map((section) => {
                const items = Array.isArray(councilAnalysis?.[section.key]) ? councilAnalysis[section.key] : [];
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
              text={analysisError || councilAnalysisState?.message || "正在汇总三位专家的异同点..."}
            />
          )}
        </div>
      ) : null}

      {(analysisReady || resultReady || councilResultState) ? (
        <div className="space-y-3">
          <StepHeader step="步骤 3/3" title="正式回复" />
          {resultReady ? (
            <ResultCard content={content} />
          ) : (
            <StepState
              status={resultError ? "error" : "loading"}
              text={resultError || councilResultState?.message || "正在整理正式回复..."}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
