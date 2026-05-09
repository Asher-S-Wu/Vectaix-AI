import { useState } from "react";
import { Download, ExternalLink, FileText, Search, Terminal, X } from "lucide-react";
import { ModelAvatar } from "./ModelVisuals";
import { formatAttachmentMeta } from "@/lib/shared/messageAttachments";
import { toBlobDownloadUrl } from "@/lib/shared/blobUrls";
import {
  getWebBrowsingToolTitle,
  isWebBrowsingIdentifier,
  normalizeWebBrowsingIdentifier,
} from "@/lib/shared/webBrowsing";

const WEB_BROWSING_PREVIEW_LIMIT = 20;

function getDomainFromUrl(url) {
  try { return new URL(url).hostname.replace("www.", ""); } catch { return ""; }
}

function WebFavicon({ url, size = 12, className = "" }) {
  const [failed, setFailed] = useState(false);
  const domain = getDomainFromUrl(url);
  if (!domain || failed) return <Search size={size} className={className} />;
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=${size * 2}`}
      alt=""
      width={size}
      height={size}
      className={`${className} rounded-sm`}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

export function AIAvatar({ model, size = 24, animate = false, className = "" }) {
  return (
    <span
      className={`inline-flex items-center justify-center overflow-hidden rounded-md ${className}`.trim()}
      style={{ width: size, height: size }}
    >
      <ModelAvatar model={model} size={size} animate={animate} />
    </span>
  );
}

export function LoadingSweepText({ text = "加载中", className = "", ariaText }) {
  // 如果是三个点，使用跳跃动画
  if (text === "...") {
    return (
      <span className={`loading-sweep ${className}`.trim()} data-text={text} aria-label={ariaText || text}>
        <span className="jump-dot">.</span>
        <span className="jump-dot">.</span>
        <span className="jump-dot">.</span>
      </span>
    );
  }
  return (
    <span className={`loading-sweep ${className}`.trim()} data-text={text} aria-label={ariaText || text}>
      {text}
    </span>
  );
}

export function ResponsiveAIAvatar({ model, mobileSize = 22, desktopSize = 26, animate = false }) {
  return (
    <>
      <span className="sm:hidden"><AIAvatar model={model} size={mobileSize} animate={animate} /></span>
      <span className="hidden sm:inline"><AIAvatar model={model} size={desktopSize} animate={animate} /></span>
    </>
  );
}

export function normalizeCopiedText(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

function getMessageText(msg) {
  if (!msg) return "";
  if (typeof msg.content === "string" && msg.content.trim()) {
    return msg.content;
  }
  if (Array.isArray(msg.parts)) {
    return msg.parts
      .map((part) => {
        if (typeof part?.text === "string") return part.text.trim();
        if (part?.fileData?.name) return `[附件] ${part.fileData.name}`;
        return "";
      })
      .filter(Boolean)
      .join("\n\n");
  }
  return "";
}

function stripThinkingBlocks(text) {
  if (typeof text !== "string" || !text) return "";
  return text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "");
}

const COUNCIL_ANALYSIS_LABELS = {
  agreement: "共识点",
  keyDifferences: "关键分歧",
  partialCoverage: "覆盖不全",
  uniqueInsights: "独特洞察",
  blindSpots: "盲点",
};

function buildCouncilAnalysisText(analysis) {
  if (!analysis || typeof analysis !== "object") return "";
  const lines = ["# 对比分析"];

  for (const [key, title] of Object.entries(COUNCIL_ANALYSIS_LABELS)) {
    lines.push(`\n## ${title}`);
    const items = Array.isArray(analysis[key]) ? analysis[key] : [];
    if (items.length === 0) {
      lines.push("- 暂无内容");
      continue;
    }
    for (const item of items) {
      const text = typeof item?.text === "string" ? item.text.trim() : "";
      if (!text) continue;
      const models = Array.isArray(item?.models) ? item.models.filter(Boolean) : [];
      const prefix = models.length > 0 ? `【${models.join(" / ")}】` : "";
      lines.push(`- ${prefix}${text}`);
    }
  }

  return lines.join("\n").trim();
}

function buildCouncilExportText(msg) {
  const sections = [];
  const analysisText = buildCouncilAnalysisText(msg?.councilAnalysis);
  const resultText = typeof msg?.content === "string" ? stripThinkingBlocks(msg.content).trim() : "";

  if (analysisText) sections.push(analysisText);
  if (resultText) sections.push(resultText);

  if (sections.length > 0) {
    return normalizeCopiedText(sections.join("\n\n"));
  }

  return "";
}

export function buildCopyText(msg) {
  if (!msg) return "";
  const councilText = buildCouncilExportText(msg);
  if (councilText) return councilText;
  const raw = getMessageText(msg);
  const cleaned = msg.role === "model" ? stripThinkingBlocks(raw) : raw;
  return normalizeCopiedText(cleaned);
}

function stripMarkdown(text) {
  if (typeof text !== "string" || !text) return "";
  return text
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?|```$/g, "").trim())
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/^[\*\-+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/^[-*_]{3,}$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildPlainText(msg) {
  if (!msg) return "";
  const councilText = buildCouncilExportText(msg);
  if (councilText) return normalizeCopiedText(stripMarkdown(councilText));
  const raw = getMessageText(msg);
  const cleaned = msg.role === "model" ? stripThinkingBlocks(raw) : raw;
  return normalizeCopiedText(stripMarkdown(cleaned));
}

export function isSelectionFullyInsideElement(el) {
  const sel = window.getSelection?.();
  if (!sel || sel.rangeCount === 0) return false;
  const anchor = sel.anchorNode;
  const focus = sel.focusNode;
  if (!anchor || !focus) return false;
  return el.contains(anchor) && el.contains(focus);
}

export function Thumb({ src, className = "", onClick }) {
  if (!src) return null;
  return (
    <button
      type="button"
      onClick={() => onClick?.(src)}
      className={`block text-left ${className}`}
      title="点击查看"
    >
      <img
        src={src}
        alt=""
        className="block max-w-[280px] sm:max-w-[240px] max-h-[240px] sm:max-h-[180px] w-auto h-auto object-cover rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800"
        loading="eager"
        decoding="async"
      />
    </button>
  );
}

export function AttachmentCard({ file, compact = false }) {
  if (!file?.name) return null;
  const canDownload = typeof file.url === "string" && /^https?:\/\//i.test(file.url);
  const downloadUrl = canDownload
    ? toBlobDownloadUrl(file.url)
    : null;

  return (
    <div className={`flex items-center gap-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white/70 px-3 py-2 ${compact ? "min-w-[220px]" : "min-w-[240px]"}`}>
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 shrink-0">
        <FileText size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-zinc-700 dark:text-zinc-300">{file.name}</div>
        <div className="truncate text-xs text-zinc-400">{formatAttachmentMeta(file)}</div>
        {typeof file.formatSummary === "string" && file.formatSummary.trim() ? (
          <div className="truncate text-xs text-zinc-400/90">{file.formatSummary}</div>
        ) : null}
      </div>
      {downloadUrl ? (
        <a
          href={downloadUrl}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
          title="下载附件"
        >
          <Download size={15} />
        </a>
      ) : null}
    </div>
  );
}

export function Citations({ citations }) {
  if (!citations || !Array.isArray(citations) || citations.length === 0) return null;

  const [open, setOpen] = useState(false);

  const uniqueCitations = [];
  const seenUrls = new Set();
  for (const c of citations) {
    if (c?.url && !seenUrls.has(c.url)) {
      seenUrls.add(c.url);
      uniqueCitations.push(c);
    }
  }

  if (uniqueCitations.length === 0) return null;

  const previewCount = Math.min(5, uniqueCitations.length);
  const previewItems = uniqueCitations.slice(0, previewCount);

  return (
    <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-700">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-2.5 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 rounded-full text-xs transition-colors"
        title="查看全部来源"
      >
        <Search size={12} className="text-zinc-500" />
        <span>信息来源</span>
        <span className="flex -space-x-1.5">
          {previewItems.map((citation, idx) => (
            <span key={idx} className="inline-flex w-4 h-4 rounded-full border border-white dark:border-zinc-700 bg-white dark:bg-zinc-800 items-center justify-center overflow-hidden">
              <WebFavicon url={citation.url} size={12} />
            </span>
          ))}
        </span>
        {uniqueCitations.length > previewCount && (
          <span className="text-zinc-500">+{uniqueCitations.length - previewCount}</span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />
          <div className="relative bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-700 w-full max-w-md p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 font-medium">
                <Search size={14} />
                信息来源
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                title="关闭"
              >
                <X size={16} />
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto fade-scrollbar">
              <div className="flex flex-col gap-2">
                {uniqueCitations.map((citation, idx) => {
                  const domain = getDomainFromUrl(citation.url) || citation.url;
                  return (
                    <a
                      key={idx}
                      href={citation.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-2.5 py-2 bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-700 dark:text-zinc-300 transition-colors"
                      title={citation.title || citation.url}
                    >
                      <WebFavicon url={citation.url} size={16} className="flex-shrink-0" />
                      <span className="truncate flex-1">
                        {citation.title || domain}
                      </span>
                      <ExternalLink size={14} className="text-zinc-400" />
                    </a>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function buildArtifactDownloadUrl(artifact) {
  if (typeof artifact?.url !== "string" || !/^https?:\/\//i.test(artifact.url)) return null;
  return toBlobDownloadUrl(artifact.url);
}

export function hasToolRunPreview(tool) {
  if (!tool || typeof tool !== "object") return false;
  const toolIdentifier = normalizeWebBrowsingIdentifier(tool.identifier);

  if (isWebBrowsingIdentifier(toolIdentifier) && Array.isArray(tool.state?.results) && tool.state.results.length > 0) {
    return true;
  }

  return Boolean(
    (typeof tool.summary === "string" && tool.summary)
    || (typeof tool.content === "string" && tool.content)
  );
}

export function ToolRunPreview({ tool }) {
  if (!hasToolRunPreview(tool)) return null;
  const toolIdentifier = normalizeWebBrowsingIdentifier(tool.identifier);

  if (isWebBrowsingIdentifier(toolIdentifier) && Array.isArray(tool.state?.results) && tool.state.results.length > 0) {
    return (
      <div className="flex max-h-[320px] flex-col gap-1.5 overflow-y-auto pr-1 mobile-scroll overscroll-contain fade-scrollbar">
        {tool.state.results.slice(0, WEB_BROWSING_PREVIEW_LIMIT).map((item, index) => {
          const href = typeof item?.url === "string" ? item.url : "";
          const title = typeof item?.title === "string" && item.title ? item.title : href;
          if (!href) return null;
          return (
            <a
              key={`${tool.id}-${index}`}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white/70 dark:bg-zinc-900/40 px-2.5 py-2 text-xs text-zinc-600 dark:text-zinc-300 hover:border-primary/40 hover:text-primary transition-colors"
            >
              <WebFavicon url={href} size={14} className="shrink-0" />
              <span className="truncate flex-1">{title}</span>
              <ExternalLink size={12} className="shrink-0 opacity-60" />
            </a>
          );
        })}
      </div>
    );
  }

  const previewText = typeof tool.summary === "string" && tool.summary
    ? tool.summary
    : (typeof tool.content === "string" ? tool.content : "");
  if (!previewText) return null;

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white/70 dark:bg-zinc-900/40 px-3 py-2 text-xs text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap break-words">
      {previewText}
    </div>
  );
}

export function ToolRunCards({ tools }) {
  if (!Array.isArray(tools) || tools.length === 0) return null;

  return (
    <div className="mt-3 flex flex-col gap-2">
      {tools.map((tool) => {
        if (!tool?.id) return null;
        const toolIdentifier = normalizeWebBrowsingIdentifier(tool.identifier);
        const isWeb = isWebBrowsingIdentifier(toolIdentifier);
        const icon = isWeb ? <Search size={13} /> : <Terminal size={13} />;
        const title = typeof tool.title === "string" && tool.title
          ? tool.title
          : (isWeb ? getWebBrowsingToolTitle(tool.apiName) : `${toolIdentifier || "tool"}.${tool.apiName || "run"}`);
        const statusText = tool.status === "error" ? "失败" : (tool.status === "running" ? "运行中" : "完成");

        return (
          <div
            key={tool.id}
            className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50/80 dark:bg-zinc-900/50 px-3 py-3"
          >
            <div className="flex items-center gap-2 mb-2">
              <div className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                {icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-zinc-700 dark:text-zinc-200">{title}</div>
                <div className="text-[11px] text-zinc-400">{statusText}</div>
              </div>
            </div>
            <ToolRunPreview tool={tool} />
          </div>
        );
      })}
    </div>
  );
}

export function ArtifactCards({ artifacts }) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) return null;

  return (
    <div className="mt-3 flex flex-col gap-2">
      {artifacts.map((artifact, index) => {
        const downloadUrl = buildArtifactDownloadUrl(artifact);
        const title = typeof artifact?.title === "string" && artifact.title ? artifact.title : `产物 ${index + 1}`;
        const meta = [
          typeof artifact?.extension === "string" && artifact.extension ? artifact.extension.toUpperCase() : "",
          Number.isFinite(artifact?.size) && artifact.size > 0 ? formatAttachmentMeta({ size: artifact.size }) : "",
        ].filter(Boolean).join(" · ");

        return (
          <div
            key={`${artifact?.url || title}-${index}`}
            className="flex items-center gap-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white/80 dark:bg-zinc-900/50 px-3 py-3"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500 shrink-0">
              <FileText size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-zinc-700 dark:text-zinc-200">{title}</div>
              <div className="truncate text-xs text-zinc-400">{meta || "沙盒导出产物"}</div>
            </div>
            {downloadUrl ? (
              <a
                href={downloadUrl}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
                title="下载产物"
              >
                <Download size={15} />
              </a>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
