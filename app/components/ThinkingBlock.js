"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronUp, FileScan, FileUp, Lightbulb, Loader2, Scale, Search, Terminal, Zap } from "lucide-react";
import Markdown from "./Markdown";
import { ModelGlyph } from "./ModelVisuals";
import { Citations, LoadingSweepText, ToolRunPreview, hasToolRunPreview } from "./MessageListHelpers";
import { getCouncilExpertDisplayLabel, SEED_MODEL_ID } from "@/lib/shared/models";

function normalizeTimeline(timeline) {
  if (!Array.isArray(timeline)) return [];
  const normalized = timeline
    .filter((step) => step && typeof step === "object")
    .map((step) => ({
      id: step.id,
      kind: step.kind,
      status: step.status,
      content: typeof step.content === "string" ? step.content : "",
      query: typeof step.query === "string" ? step.query : "",
      title: typeof step.title === "string" ? step.title : "",
      url: typeof step.url === "string" ? step.url : "",
      message: typeof step.message === "string" ? step.message : "",
      round: Number.isFinite(step.round) ? step.round : null,
      resultCount: Number.isFinite(step.resultCount) ? step.resultCount : null,
      synthetic: step.synthetic === true,
    }))
    .filter((step) => step.kind === "thought" || step.kind === "search" || step.kind === "reader" || step.kind === "sandbox" || step.kind === "tool" || step.kind === "upload" || step.kind === "parse" || step.kind === "planner");

  return normalized.reduce((acc, step) => {
    const last = acc[acc.length - 1];
    if (last?.kind === "thought" && step.kind === "thought") {
      acc[acc.length - 1] = {
        ...last,
        id: step.id || last.id,
        status: step.status === "streaming" ? "streaming" : last.status,
        content: [last.content, step.content].filter(Boolean).join("\n\n"),
        synthetic: last.synthetic && step.synthetic,
      };
      return acc;
    }
    acc.push(step);
    return acc;
  }, []);
}

function normalizeCouncilExpertStates(states) {
  if (!Array.isArray(states)) return [];
  return states
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      key: typeof item.key === "string" ? item.key : "",
      modelId: typeof item.modelId === "string" ? item.modelId : "",
      label: typeof item.label === "string" ? item.label : "专家",
      status: typeof item.status === "string" ? item.status : "pending",
      phase: typeof item.phase === "string" ? item.phase : "pending",
      message: typeof item.message === "string" ? item.message : "",
    }))
    .filter((item) => item.key || item.modelId || item.label);
}

function normalizeCouncilSummaryState(state) {
  if (!state || typeof state !== "object") return null;
  return {
    modelId: typeof state.modelId === "string" ? state.modelId : SEED_MODEL_ID,
    label: typeof state.label === "string" ? state.label : "Seed",
    status: typeof state.status === "string" ? state.status : "pending",
    phase: typeof state.phase === "string" ? state.phase : "pending",
    message: typeof state.message === "string" ? state.message : "",
  };
}

function StepStatusText({ text, active = false }) {
  if (active) {
    return <LoadingSweepText text={text} className="loading-sweep-step" />;
  }
  return <span>{text}</span>;
}

function SplitStatusText({ prefix = "", status = "", suffix = "", active = false }) {
  return (
    <span className="inline-flex max-w-full items-center">
      {prefix ? <span className="mr-1.5 shrink-0">{prefix}</span> : null}
      {status ? <StepStatusText text={status} active={active} /> : null}
      {suffix ? <span className={status ? "ml-0.5" : ""}>{suffix}</span> : null}
    </span>
  );
}

function getDisplayHostname(url) {
  if (typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    return new URL(trimmed).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

export default function ThinkingBlock({
  thought,
  isStreaming,
  isSearching,
  searchQuery,
  searchError,
  timeline,
  councilExpertStates,
  councilSummaryState,
  councilExperts,
  tools,
  bodyText,
  showThoughtDetails = true,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [expandedTimelineId, setExpandedTimelineId] = useState(null);
  const [openExpertKey, setOpenExpertKey] = useState(null);
  const containerRef = useRef(null);
  const autoCollapsedRef = useRef(false);
  const manualExpandedStepIdRef = useRef(null);
  const manualOpenMainRef = useRef(false);
  const safeThought = typeof thought === "string" ? thought : "";
  const safeBodyText = typeof bodyText === "string" ? bodyText : "";
  const safeSearchError = typeof searchError === "string" ? searchError : "";
  const timelineItems = normalizeTimeline(timeline);
  const normalizedCouncilExpertStates = normalizeCouncilExpertStates(councilExpertStates);
  const normalizedCouncilSummaryState = normalizeCouncilSummaryState(councilSummaryState);
  const hasCouncilMode = normalizedCouncilExpertStates.length > 0 || normalizedCouncilSummaryState !== null;
  const hasTimeline = timelineItems.length > 0;
  const toolsByTimelineId = new Map(
    (Array.isArray(tools) ? tools : [])
      .filter((tool) => tool && typeof tool === "object" && typeof tool.id === "string" && tool.id)
      .map((tool) => [`timeline_${tool.id}`, tool])
  );

  // 滚动到容器底部（仅简单模式的思考内容）
  useEffect(() => {
    if (!collapsed) {
      const el = containerRef.current;
      if (el) {
        el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
      }
    }
  }, [thought, timeline, collapsed]);

  // 时间线模式：自动展开最新的思考步骤
  useEffect(() => {
    if (hasCouncilMode) return;
    if (!hasTimeline) return;
    if (autoCollapsedRef.current) return;

    const timelineForExpand = normalizeTimeline(timeline);
    const lastStep = timelineForExpand[timelineForExpand.length - 1] || null;
    if (lastStep && lastStep.kind !== "thought") {
      if (manualExpandedStepIdRef.current) return;
      setExpandedTimelineId((prev) => {
        if (prev === null) return prev;
        return null;
      });
      return;
    }

    const lastThoughtStep = [...timelineForExpand]
      .reverse()
      .find((step) => step.kind === "thought");

    if (!lastThoughtStep?.id) return;
    if (manualExpandedStepIdRef.current) return;
    setExpandedTimelineId((prev) => {
      if (prev === lastThoughtStep.id) return prev;
      return lastThoughtStep.id;
    });
  }, [hasCouncilMode, hasTimeline, timeline]);

  // 简单模式：思考流式输出时自动展开内层思考气泡
  useEffect(() => {
    if (hasCouncilMode) return;
    if (hasTimeline) return;
    if (autoCollapsedRef.current) return;
    if (isStreaming || safeThought) {
      setExpandedTimelineId("__simple__");
    }
  }, [hasCouncilMode, hasTimeline, isStreaming, safeThought]);

  // 正文开始输出后，自动折叠外层容器
  useEffect(() => {
    const currentLength = safeBodyText.length;
    if (currentLength > 0 && !autoCollapsedRef.current) {
      autoCollapsedRef.current = true;
      manualExpandedStepIdRef.current = null;
      manualOpenMainRef.current = false;
      setCollapsed(true);
      setExpandedTimelineId(null);
    }
    if (currentLength === 0) {
      autoCollapsedRef.current = false;
    }
  }, [safeBodyText]);

  // ── 外层标题文本（始终固定） ──
  const headerText = "执行过程";

  // ── 外层图标（始终固定） ──
  const headerIcon = <Zap className="thinking-icon-header" />;

  const activeThoughtLabel = "思考中";
  const completedThoughtLabel = "已思考";
  const toggleExpandedStep = (stepId) => {
    setExpandedTimelineId((prev) => {
      const nextId = prev === stepId ? null : stepId;
      manualExpandedStepIdRef.current = nextId;
      return nextId;
    });
  };

  // ── 渲染时间线内的单个步骤（第二层折叠项）──
  const renderTimelineStep = (step, idx) => {
    const isExpanded = expandedTimelineId === step.id;
    const isRunning = step.status === "running";
    const isError = step.status === "error";

    const getTitle = () => {
      if (step.title) return step.title;
      if (step.kind === "thought") return "思考过程";
      if (step.kind === "search") {
        const query = step.query ? `「${step.query}」` : "";
        const countLabel = Number.isFinite(step.resultCount) && step.resultCount > 0 ? `（${step.resultCount}条）` : "";
        if (isRunning) return `联网搜索中${query}`;
        if (isError) return `联网搜索失败${query}`;
        return `联网搜索完成${query}${countLabel}`;
      }
      if (step.kind === "reader") {
        const hostname = getDisplayHostname(step.url);
        const target = hostname ? `「${hostname}」` : "";
        const countLabel = Number.isFinite(step.resultCount) && step.resultCount > 0 ? `（${step.resultCount}页）` : "";
        if (isRunning) return `浏览网页中${target}`;
        if (isError) return `网页获取失败${target}`;
        return `网页阅读完成${target}${countLabel}`;
      }
      if (step.kind === "planner") return isRunning ? "正在制定计划" : (isError ? "制定计划失败" : "执行计划已确定");
      if (step.kind === "writer") return isRunning ? "正在整理结果" : (isError ? "整理结果失败" : "最终结果已生成");
      if (step.kind === "sandbox") return isRunning ? "正在准备运行环境" : (isError ? "运行环境准备失败" : "运行环境已准备完成");
      if (step.kind === "upload") return isRunning ? "正在上传文件" : (isError ? "文件上传失败" : "文件已上传");
      if (step.kind === "parse") return isRunning ? "正在解析文件" : (isError ? "文件解析失败" : "文件已解析");
      return "处理中";
    };

    const hasDetail = (() => {
      if (step.kind === "thought") return Boolean(step.content);
      if (step.kind === "search") return Boolean(step.query || Number.isFinite(step.resultCount) || (isError && step.message));
      if (step.kind === "reader") return Boolean(getDisplayHostname(step.url) || Number.isFinite(step.resultCount) || (isError && step.message));
      if (step.kind === "planner") return false;
      if (step.kind === "writer") return Boolean(step.content || step.message);
      if (step.kind === "sandbox") return Boolean(step.content || (isError && (step.message || step.title)));
      if (step.kind === "upload" || step.kind === "parse") return false;
      return false;
    })();
    const isThoughtStreaming = step.status === "streaming";
    const isManualExpanded = manualExpandedStepIdRef.current === step.id;
    const showThoughtDots = isThoughtStreaming && (!hasDetail || (isExpanded && !isManualExpanded));

    const thoughtIcon = <Lightbulb className="thinking-icon-step" />;
    const linkedTool = step.id ? toolsByTimelineId.get(step.id) : null;
    const hasLinkedToolPreview = hasToolRunPreview(linkedTool);

    const icon = step.kind === "search"
      ? <Search className="thinking-icon-step" />
      : step.kind === "reader"
          ? <FileScan className="thinking-icon-step" />
      : step.kind === "sandbox"
        ? <Terminal className="thinking-icon-step" />
        : step.kind === "planner"
          ? <Scale className="thinking-icon-step" />
          : step.kind === "writer"
            ? <Zap className="thinking-icon-step" />
        : step.kind === "upload"
          ? <FileUp className="thinking-icon-step" />
          : step.kind === "parse"
            ? <FileScan className="thinking-icon-step" />
              : step.kind === "tool"
                ? <Terminal className="thinking-icon-step" />
                : thoughtIcon;

    const capsuleClass = `thinking-capsule flex w-fit max-w-full items-center gap-2 font-medium transition-all duration-300 py-1.5 px-3 rounded-full ${isError ? "bg-red-50 dark:bg-red-900/20 text-red-600" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:text-primary hover:bg-primary/5"}`;

    if (step.kind === "thought") {
      const hasContent = typeof step.content === "string" && step.content.trim();
      const thoughtDetailText = hasContent
        ? step.content
        : "这一阶段没有可展示的思考内容。";
      const canExpandThought = showThoughtDetails && hasContent;
      const isThoughtOpen = canExpandThought && isExpanded;
      return (
        <div key={step.id || `thought-${idx}`} className="w-full max-w-2xl">
          {canExpandThought ? (
            <button
              type="button"
              onClick={() => toggleExpandedStep(step.id)}
              className={capsuleClass}
            >
              <div className={`p-1 rounded-md ${isThoughtStreaming ? "bg-primary/10 text-primary animate-pulse" : "bg-zinc-200 dark:bg-zinc-700"}`}>
                {icon}
              </div>
              <StepStatusText text={isThoughtStreaming ? activeThoughtLabel : "思考过程"} active={showThoughtDots} />
              <div className="ml-auto flex items-center gap-1">
                {isThoughtOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </div>
            </button>
          ) : (
            <div className={`${capsuleClass} cursor-default opacity-80`}>
              <div className="p-1 rounded-md bg-zinc-200 dark:bg-zinc-700">
                {icon}
              </div>
              <StepStatusText text={isThoughtStreaming ? activeThoughtLabel : completedThoughtLabel} active={showThoughtDots} />
            </div>
          )}
          <AnimatePresence>
            {isThoughtOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div
                  className={`thinking-content mt-2 ml-4 p-4 glass-effect rounded-2xl text-sm leading-relaxed transition-all duration-500 ${isThoughtStreaming ? "border-primary/40 ring-1 ring-primary/20 shadow-[0_0_15px_rgba(37,99,235,0.12)] dark:shadow-[0_0_15px_rgba(37,99,235,0.1)]" : "border-zinc-200/50"}`}
                  ref={containerRef}
                >
                  <Markdown
                    enableHighlight={!isThoughtStreaming}
                    enableMath={true}
                    className="prose-xs text-zinc-500 dark:text-zinc-400"
                  >
                    {thoughtDetailText}
                  </Markdown>
                  {isThoughtStreaming && (
                    <div className="sticky bottom-2 flex justify-end mt-2 pointer-events-none">
                      <div className="text-[10px] text-primary/70 flex items-center gap-1.5 backdrop-blur-md bg-white/80 dark:bg-black/80 px-2.5 py-1 rounded-full border border-primary/20 shadow-sm pointer-events-auto">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        思考过程中...
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      );
    }

    if (step.kind === "search") {
      const querySuffix = step.query ? `「${step.query}」` : "";
      const isOpen = hasLinkedToolPreview && isExpanded;
      return (
        <div key={step.id || `search-${idx}`} className="w-full max-w-full md:max-w-[760px]">
          {hasLinkedToolPreview ? (
            <button type="button" onClick={() => toggleExpandedStep(step.id)} className={capsuleClass}>
              {icon}
              {isRunning ? (
                <SplitStatusText status="联网搜索中" suffix={querySuffix} active />
              ) : (
                <span>{isError ? `联网搜索失败${querySuffix}` : `联网搜索完成${querySuffix}`}</span>
              )}
              <div className="ml-auto flex items-center gap-1">
                {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </div>
            </button>
          ) : (
            <div className={capsuleClass}>
              {icon}
              {isRunning ? (
                <SplitStatusText status="联网搜索中" suffix={querySuffix} active />
              ) : (
                <span>{isError ? `联网搜索失败${querySuffix}` : `联网搜索完成${querySuffix}`}</span>
              )}
            </div>
          )}
          <AnimatePresence>
            {isOpen && linkedTool ? (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-2 ml-4 w-full max-w-[720px]">
                  <ToolRunPreview tool={linkedTool} />
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      );
    }

    if (step.kind === "reader") {
      const hostname = getDisplayHostname(step.url);
      const urlSuffix = hostname ? `「${hostname}」` : "";
      const isOpen = hasLinkedToolPreview && isExpanded;
      return (
        <div key={step.id || `reader-${idx}`} className="w-full max-w-full md:max-w-[760px]">
          {hasLinkedToolPreview ? (
            <button type="button" onClick={() => toggleExpandedStep(step.id)} className={capsuleClass}>
              {icon}
              {isRunning ? (
                <SplitStatusText status="浏览网页中" suffix={urlSuffix} active />
              ) : (
                <span>{isError ? `网页获取失败${urlSuffix}` : `网页阅读完成${urlSuffix}`}</span>
              )}
              <div className="ml-auto flex items-center gap-1">
                {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </div>
            </button>
          ) : (
            <div className={capsuleClass}>
              {icon}
              {isRunning ? (
                <SplitStatusText status="浏览网页中" suffix={urlSuffix} active />
              ) : (
                <span>{isError ? `网页获取失败${urlSuffix}` : `网页阅读完成${urlSuffix}`}</span>
              )}
            </div>
          )}
          <AnimatePresence>
            {isOpen && linkedTool ? (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-2 ml-4 w-full max-w-[720px]">
                  <ToolRunPreview tool={linkedTool} />
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      );
    }

    if (step.kind === "sandbox") {
      const detail = isError ? (step.message || step.title || "") : "";
      const titleText = getTitle();
      const isOpen = hasLinkedToolPreview && isExpanded;
      return (
        <div key={step.id || `sandbox-${idx}`} className="w-full max-w-full md:max-w-[760px]">
          {hasLinkedToolPreview ? (
            <button type="button" onClick={() => toggleExpandedStep(step.id)} className={capsuleClass}>
              {icon}
              <StepStatusText text={detail || titleText} active={isRunning} />
              <div className="ml-auto flex items-center gap-1">
                {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </div>
            </button>
          ) : (
            <div className={capsuleClass}>
              {icon}
              <StepStatusText text={detail || titleText} active={isRunning} />
            </div>
          )}
          <AnimatePresence>
            {isOpen && linkedTool ? (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-2 ml-4 w-full max-w-[720px]">
                  <ToolRunPreview tool={linkedTool} />
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      );
    }

    if (step.kind === "planner") {
      const titleText = getTitle();
      return (
        <div key={step.id || `planner-${idx}`} className="w-full max-w-full md:max-w-[760px]">
          <div className={capsuleClass}>
            {icon}
            <StepStatusText text={titleText} active={isRunning} />
          </div>
        </div>
      );
    }

    if (step.kind === "writer") {
      const detail = step.message || step.title || "";
      const titleText = getTitle();
      const canExpand = Boolean(step.content);
      const isOpen = canExpand && isExpanded;
      return (
        <div key={step.id || `${step.kind}-${idx}`} className="w-full max-w-full md:max-w-[760px]">
          {canExpand ? (
            <button type="button" onClick={() => toggleExpandedStep(step.id)} className={capsuleClass}>
              {icon}
              <StepStatusText text={detail || titleText} active={isRunning} />
              <div className="ml-auto flex items-center gap-1">
                {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </div>
            </button>
          ) : (
            <div className={capsuleClass}>
              {icon}
              <StepStatusText text={detail || titleText} active={isRunning} />
            </div>
          )}
          <AnimatePresence>
            {isOpen ? (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div
                  className={`thinking-content mt-2 ml-4 p-4 glass-effect rounded-2xl text-sm leading-relaxed transition-all duration-500 ${isRunning ? "border-primary/40 ring-1 ring-primary/20 shadow-[0_0_15px_rgba(37,99,235,0.12)] dark:shadow-[0_0_15px_rgba(37,99,235,0.1)]" : "border-zinc-200/50"}`}
                  ref={containerRef}
                >
                  <Markdown
                    enableHighlight={!isRunning}
                    enableMath={true}
                    className="prose-xs text-zinc-500 dark:text-zinc-400"
                  >
                    {step.content}
                  </Markdown>
                  {isRunning && (
                    <div className="sticky bottom-2 flex justify-end mt-2 pointer-events-none">
                      <div className="text-[10px] text-primary/70 flex items-center gap-1.5 backdrop-blur-md bg-white/80 dark:bg-black/80 px-2.5 py-1 rounded-full border border-primary/20 shadow-sm pointer-events-auto">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        思考过程中...
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      );
    }

    if (step.kind === "upload" || step.kind === "parse") {
      const detail = step.message || step.title || "";
      const titleText = getTitle();
      return (
        <div key={step.id || `${step.kind}-${idx}`} className="w-full max-w-full md:max-w-[760px]">
          <div className={capsuleClass}>
            {icon}
            <StepStatusText text={detail || titleText} active={isRunning} />
          </div>
        </div>
      );
    }

    if (step.kind === "tool") {
      const label = step.content || step.message || step.title || "沙箱执行";
      const isOpen = hasLinkedToolPreview && isExpanded;
      return (
        <div key={step.id || `tool-${idx}`} className="w-full max-w-full md:max-w-[760px]">
          {hasLinkedToolPreview ? (
            <button type="button" onClick={() => toggleExpandedStep(step.id)} className={capsuleClass}>
              {icon}
              <StepStatusText text={label} active={isRunning} />
              <div className="ml-auto flex items-center gap-1">
                {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </div>
            </button>
          ) : (
            <div className={capsuleClass}>
              {icon}
              <StepStatusText text={label} active={isRunning} />
            </div>
          )}
          <AnimatePresence>
            {isOpen && linkedTool ? (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-2 ml-4 w-full max-w-[720px]">
                  <ToolRunPreview tool={linkedTool} />
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      );
    }

    return null;
  };

  // ══════════════════════════════════════════
  //  统一渲染：外层执行过程容器 + 内层步骤
  // ══════════════════════════════════════════
  return (
    <div className="thinking-block mb-2 w-full max-w-full">
      {hasCouncilMode ? (
        /* ── Council 模式：直接以内联胶囊显示，不包裹折叠按钮 ── */
        <div className="thinking-timeline flex flex-col border-l-2 border-zinc-200/80 dark:border-zinc-700/80">
          {normalizedCouncilExpertStates.map((expert) => {
            const isRunning = expert.status === "running";
            const isError = expert.status === "error";
            const isDone = expert.status === "done";
            const isSkipped = expert.status === "skipped";
            const expertKey = expert.key || expert.label;
            const expertData = Array.isArray(councilExperts)
              ? councilExperts.find((e) => e.label === expert.label)
              : null;
            const displayLabel = getCouncilExpertDisplayLabel(expert);
            const hasContent = isDone && expertData && typeof expertData.content === "string" && expertData.content.trim();
            const isOpen = openExpertKey === expertKey;
            const statusText = isSkipped
              ? "已跳过"
              : isError
              ? (expert.message || "回答失败")
              : isDone
              ? "已完成"
              : expert.message || "等待中";
            return (
              <div key={expertKey} className="w-full max-w-full md:max-w-[760px]">
                <div
                  className={`thinking-capsule inline-flex w-fit max-w-full items-center font-medium transition-colors ${isError ? "thinking-step-error text-red-600" : isSkipped ? "text-zinc-300" : "text-zinc-500"} ${hasContent ? "cursor-pointer hover:text-zinc-700" : ""}`}
                  onClick={hasContent ? () => setOpenExpertKey(isOpen ? null : expertKey) : undefined}
                >
                  <ModelGlyph model={expert.modelId} size={14} />
                  <SplitStatusText prefix={`${displayLabel} · `} status={statusText} active={isRunning} />
                  {hasContent ? (isOpen ? <ChevronUp size={12} className="ml-1 shrink-0" /> : <ChevronDown size={12} className="ml-1 shrink-0" />) : null}
                </div>
                {isOpen && expertData && (
                  <div className="mt-2 mb-1 ml-1 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-sm text-zinc-800 dark:text-zinc-200">
                    <Markdown enableHighlight={true} enableMath={true}>{expertData.content}</Markdown>
                    <Citations citations={expertData.citations} />
                  </div>
                )}
              </div>
            );
          })}
          {normalizedCouncilSummaryState ? (() => {
            const s = normalizedCouncilSummaryState;
            const isRunning = s.status === "running";
            const isError = s.status === "error";
            const statusText = isError
              ? (s.message || "汇总失败")
              : s.status === "done"
              ? "已完成"
              : s.message || "等待中";
            return (
              <div className="w-full max-w-full md:max-w-[760px]">
                <div className={`thinking-capsule inline-flex w-fit max-w-full items-center font-medium transition-colors ${isError ? "thinking-step-error text-red-600" : "text-zinc-500"}`}>
                  <ModelGlyph model={s.modelId} size={14} />
                  <SplitStatusText prefix={`${s.label} · `} status={statusText} active={isRunning} />
                </div>
              </div>
            );
          })() : null}
        </div>
      ) : (
        /* ── 非 Council 模式：外层折叠按钮 + 内层步骤 ── */
        <>
          {/* 第一层：外层折叠按钮 */}
          <button
            onClick={() => {
              if (collapsed) {
                manualOpenMainRef.current = true;
              } else {
                manualOpenMainRef.current = false;
              }
              setCollapsed(!collapsed);
            }}
            className="thinking-btn flex items-center font-medium mb-1.5 transition-colors text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 bg-zinc-100 dark:bg-zinc-800"
          >
            {headerIcon}
            <span className="thinking-btn-label flex items-center">
              <span className="truncate max-w-[240px]">{headerText}</span>
              {null}
            </span>
            {collapsed ? (
              <ChevronDown className="thinking-icon-chevron" />
            ) : (
              <ChevronUp className="thinking-icon-chevron" />
            )}
          </button>

          {/* 搜索错误提示（非时间线模式） */}
          {!hasTimeline && !isSearching && safeSearchError ? (
            <div className="thinking-error-tip text-red-600 bg-red-50 border border-red-200">
              联网搜索失败：{safeSearchError}
            </div>
          ) : null}

          {/* 内层内容（第二层折叠区域） */}
          <AnimatePresence>
            {!collapsed && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                {hasTimeline ? (
                  /* 时间线模式：内层各步骤气泡（每个可独立折叠 = 第二层） */
                  <div className="thinking-timeline flex flex-col border-l-2 border-zinc-200/80 dark:border-zinc-700/80">
                    {timelineItems.map((step, idx) => renderTimelineStep(step, idx))}
                  </div>
                ) : (
                  /* 简单模式：内嵌一个"思考过程"气泡（第二层） */
                  safeThought ? (
                    <div className="thinking-timeline flex flex-col border-l-2 border-zinc-200/80 dark:border-zinc-700/80">
                      <div className="w-full max-w-full md:max-w-[760px]">
                        <button
                          type="button"
                          onClick={() => {
                            setExpandedTimelineId((prev) => prev === "__simple__" ? null : "__simple__");
                          }}
                          className="thinking-capsule inline-flex w-fit max-w-full items-center font-medium transition-colors text-zinc-500 cursor-pointer"
                        >
                          <Lightbulb className="thinking-icon-step" />
                          <StepStatusText text={isStreaming ? activeThoughtLabel : "思考过程"} active={isStreaming && expandedTimelineId !== "__simple__"} />
                          {expandedTimelineId === "__simple__" ? <ChevronUp className="thinking-icon-chevron" /> : <ChevronDown className="thinking-icon-chevron" />}
                        </button>
                        {expandedTimelineId === "__simple__" ? (
                          <div
                            className={`thinking-content thinking-content-panel bg-white/60 dark:bg-zinc-800/60 border overflow-y-auto fade-scrollbar w-full max-w-full md:max-w-[760px] text-zinc-400 transition-all duration-500 ${isStreaming ? "border-primary/40 ring-1 ring-primary/20 shadow-[0_0_15px_rgba(37,99,235,0.12)] dark:shadow-[0_0_15px_rgba(37,99,235,0.1)]" : "border-zinc-200/60 dark:border-zinc-700/60"}`}
                            ref={containerRef}
                          >
                            <Markdown
                              enableHighlight={!isStreaming}
                              enableMath={true}
                              className="prose-xs prose-pre:bg-zinc-800 prose-pre:text-zinc-100 prose-code:text-xs thinking-prose"
                            >
                              {safeThought}
                            </Markdown>
                            {isStreaming && (
                              <div className="sticky bottom-2 flex justify-end mt-2 pointer-events-none">
                                <div className="text-[10px] text-primary/70 flex items-center gap-1.5 backdrop-blur-md bg-white/80 dark:bg-black/80 px-2.5 py-1 rounded-full border border-primary/20 shadow-sm pointer-events-auto">
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  思考过程中...
                                </div>
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : isStreaming ? (
                    <div className="thinking-timeline flex flex-col border-l-2 border-zinc-200/80 dark:border-zinc-700/80">
                      <div className="w-full max-w-full md:max-w-[760px]">
                        <div className="thinking-capsule inline-flex w-fit max-w-full items-center font-medium text-zinc-500">
                          <LoadingSweepText text="···" className="loading-sweep-dots" />
                        </div>
                      </div>
                    </div>
                  ) : null
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}
