
import { useI18n } from "@/lib/client/i18n";
import { translate } from "@/lib/shared/i18n.mjs";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { Download, ExternalLink, FileText, Globe, Loader2, Search, Terminal, X } from "lucide-react";
import BrandMark from "../common/BrandMark";
import { formatAttachmentMeta } from "@/lib/shared/messageAttachments";
import { toFileDownloadUrl } from "@/lib/shared/fileUrls";
import {
  getWebBrowsingToolTitle,
  isWebBrowsingIdentifier,
  normalizeWebBrowsingIdentifier,
} from "@/lib/shared/webBrowsing";

const WEB_BROWSING_PREVIEW_LIMIT = 20;

function getDomainFromUrl(url) {
  try { return new URL(url).hostname.replace("www.", ""); } catch { return ""; }
}

export function AIAvatar({ size = 24, className = "" }) {
  return (
    <span
      className={`inline-flex items-center justify-center overflow-hidden rounded-md ${className}`.trim()}
      style={{ width: size, height: size }}
    >
      <BrandMark size={size} />
    </span>
  );
}

export function LoadingSweepText({ text, className = "", ariaText }) {
  const { t } = useI18n();
  text = text ?? t("加载中", "Loading");
  if (text === "...") {
    return (
      <span className={`loading-sweep ${className}`.trim()} data-text={text} aria-label={ariaText || (text === "..." ? t("加载中", "Loading") : text)}>
        <span className="jump-dot">.</span>
        <span className="jump-dot">.</span>
        <span className="jump-dot">.</span>
      </span>
    );
  }
  return (
    <span className={`loading-sweep ${className}`.trim()} data-text={text} aria-label={ariaText || (text === "..." ? t("加载中", "Loading") : text)}>
      {text}
    </span>
  );
}

export function ResponsiveAIAvatar({ mobileSize = 22, desktopSize = 26 }) {
  return (
    <>
      <span className="sm:hidden"><AIAvatar size={mobileSize} /></span>
      <span className="hidden sm:inline"><AIAvatar size={desktopSize} /></span>
    </>
  );
}

export function normalizeCopiedText(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

function getMessageText(msg, locale) {
  if (!msg) return "";
  if (typeof msg.content === "string" && msg.content.trim()) {
    return msg.content;
  }
  if (Array.isArray(msg.parts)) {
    return msg.parts
      .map((part) => {
        if (typeof part?.text === "string") return part.text.trim();
        if (part?.fileData?.name) return translate(locale, "[附件] {name}", "[Attachment] {name}", { name: part.fileData.name });
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

export function buildCopyText(msg, locale) {
  if (!msg) return "";
  const raw = getMessageText(msg, locale);
  const cleaned = msg.role === "model" ? stripThinkingBlocks(raw) : raw;
  return normalizeCopiedText(cleaned);
}

export function isSelectionFullyInsideElement(el) {
  const sel = window.getSelection?.();
  if (!sel || sel.rangeCount === 0) return false;
  const anchor = sel.anchorNode;
  const focus = sel.focusNode;
  if (!anchor || !focus) return false;
  return el.contains(anchor) && el.contains(focus);
}

export function Thumb({ src, previewSrc = "", className = "", onClick }) {
  const { t } = useI18n();
  const [loadedSrc, setLoadedSrc] = useState("");

  useEffect(() => {
    if (!src || !previewSrc || previewSrc === src) return;

    let cancelled = false;
    const image = new window.Image();
    image.onload = () => {
      if (!cancelled) setLoadedSrc(src);
    };
    image.src = src;

    return () => {
      cancelled = true;
    };
  }, [src, previewSrc]);

  if (!src) return null;
  const activeSrc = previewSrc && previewSrc !== src && loadedSrc !== src ? previewSrc : src;

  return (
    <button
      type="button"
      onClick={() => onClick?.(activeSrc)}
      className={`block rounded-lg text-left group/thumb ${className}`}
      aria-label={t("查看大图", "View full-size image")}
    >
      <Image
        src={activeSrc}
        alt={t("图片附件", "Image attachment")}
        width={280}
        height={240}
        unoptimized
        className="block max-w-[240px] sm:max-w-[280px] max-h-[180px] sm:max-h-[240px] w-auto h-auto object-cover rounded-lg border border-zinc-200 bg-zinc-50 transition-opacity group-hover/thumb:opacity-90"
        loading="lazy"
        decoding="async"
      />
    </button>
  );
}

export function AttachmentCard({ file, compact = false }) {
  const { t, locale } = useI18n();
  if (!file?.name) return null;
  const canDownload = typeof file.url === "string" && file.url.startsWith("/api/files/");
  const downloadUrl = canDownload
    ? toFileDownloadUrl(file.url)
    : null;

  return (
    <div className={`flex w-full max-w-sm items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-zinc-800 ${compact ? "sm:min-w-[220px]" : "sm:min-w-[240px]"}`}>
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 shrink-0">
        <FileText size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-zinc-700" title={file.name}>{file.name}</div>
        <div className="truncate text-xs text-zinc-500">{formatAttachmentMeta(file, locale)}</div>
        {file.category === "audio" && file.url ? (
          <audio controls preload="metadata" src={file.url} className="mt-2 h-8 w-full max-w-[320px]" />
        ) : null}
        {file.category === "video" && file.url ? (
          <video controls preload="metadata" src={file.url} className="mt-2 max-h-48 w-full max-w-[320px] rounded-lg bg-black" />
        ) : null}
      </div>
      {downloadUrl ? (
        <a
          href={downloadUrl}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
          title={t("下载附件", "Download attachment")}
          aria-label={t("下载 {name}", "Download {name}", { name: file.name })}
        >
          <Download size={15} />
        </a>
      ) : null}
    </div>
  );
}

export function Citations({ citations }) {
  const { t, formatNumber } = useI18n();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  if (!citations || !Array.isArray(citations) || citations.length === 0) return null;

  const uniqueCitations = [];
  const seenUrls = new Set();
  for (const c of citations) {
    if (c?.url && !seenUrls.has(c.url)) {
      seenUrls.add(c.url);
      uniqueCitations.push(c);
    }
  }

  if (uniqueCitations.length === 0) return null;

  const previewItems = uniqueCitations.slice(0, 3);

  return (
    <div className="mt-3 pt-3 border-t border-zinc-200">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="inline-flex items-center gap-2 px-3 py-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 rounded-full text-xs transition-colors"
      >
        <Globe size={13} className="text-zinc-500" />
        <span>{t("{count} 个信息来源", "{count} sources", { count: formatNumber(uniqueCitations.length) })}</span>
        <span className="hidden max-w-[16rem] truncate text-zinc-500 sm:inline">{previewItems.map(item => getDomainFromUrl(item.url)).filter(Boolean).slice(0, 3).join("、")}</span>
      </button>

      {typeof document !== "undefined" && createPortal(<AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center px-4" role="dialog" aria-modal="true" aria-label={t("信息来源", "Sources")}>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0 bg-black/40"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              className="relative bg-white rounded-2xl shadow-pop border border-zinc-200 dark:border-zinc-700 w-full max-w-md p-4"
            >
            <div className="flex items-center justify-between mb-3">
              <h2 className="flex items-center gap-2 text-sm text-zinc-800 font-medium">
                <Globe size={14} />
                {t("信息来源", "Sources")}
              </h2>
              <button
                type="button"
                autoFocus
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100"
                aria-label={t("关闭", "Close")}
              >
                <X size={16} />
              </button>
            </div>

              <div className="max-h-[60vh] overflow-y-auto fade-scrollbar">
                <div className="flex flex-col gap-0.5">
                  {uniqueCitations.map((citation, idx) => {
                    const domain = getDomainFromUrl(citation.url) || citation.url;
                    return (
                      <a
                        key={idx}
                        href={citation.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-100 rounded-lg text-sm text-zinc-700 transition-colors"
                        title={citation.title || citation.url}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{citation.title || domain}</span>
                          <span className="block truncate text-xs text-zinc-500">{domain}</span>
                        </span>
                        <ExternalLink size={14} className="shrink-0 text-zinc-400" />
                      </a>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>, document.body)}
    </div>
  );
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
              className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-xs text-zinc-600 hover:border-primary/40 hover:text-primary transition-colors"
            >
              <Globe size={14} className="shrink-0" />
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
    <div className="max-h-60 overflow-y-auto fade-scrollbar rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600 whitespace-pre-wrap break-words">
      {previewText}
    </div>
  );
}

export function ToolRunCards({ tools }) {
  const { t, locale, localizeMessage } = useI18n();
  if (!Array.isArray(tools) || tools.length === 0) return null;

  return (
    <div className="mt-3 flex flex-col gap-2">
      {tools.map((tool) => {
        if (!tool?.id) return null;
        const toolIdentifier = normalizeWebBrowsingIdentifier(tool.identifier);
        const isWeb = isWebBrowsingIdentifier(toolIdentifier);
        const icon = isWeb ? <Search size={13} /> : <Terminal size={13} />;
        const title = typeof tool.title === "string" && tool.title
          ? localizeMessage(tool.title)
          : (isWeb ? getWebBrowsingToolTitle(tool.apiName, locale) : t("工具调用", "Tool call"));
        const statusText = tool.status === "error" ? t("失败", "Failed") : (tool.status === "running" ? t("运行中", "Running") : t("完成", "Completed"));
        const isRunning = tool.status === "running";

        return (
          <div
            key={tool.id}
            className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3"
          >
            <div className="flex items-center gap-2 mb-2">
              <div className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-zinc-200 text-zinc-600">
                {isRunning ? <Loader2 size={13} className="animate-spin motion-reduce:animate-none text-primary" /> : icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-zinc-700">{title}</div>
                <div className={`text-xs ${tool.status === "error" ? "text-red-500" : isRunning ? "text-primary" : "text-zinc-500"}`}>{statusText}</div>
              </div>
            </div>
            <ToolRunPreview tool={tool} />
          </div>
        );
      })}
    </div>
  );
}
