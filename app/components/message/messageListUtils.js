import {
  getWebBrowsingToolTitle,
  isWebBrowsingIdentifier,
  normalizeWebBrowsingIdentifier,
} from "@/lib/shared/webBrowsing";
import { translate } from "@/lib/shared/i18n.mjs";

const PENDING_RUN_TEXTS = new Set(["正在处理中…", "Working…"]);

export function getStarterPrompts(locale) {
  const t = (zh, en) => translate(locale, zh, en);
  return [
    { icon: "compass", title: t("调研一个主题", "Research a topic"), description: t("帮我调研一个主题，查找可靠来源，比较不同观点，整理成一份有出处的报告。先问我想研究什么。", "Help me research a topic, find reliable sources, compare different perspectives, and write a report with citations. Start by asking what I want to research.") },
    { icon: "chart", title: t("分析文件和数据", "Analyze files and data"), description: t("帮我分析资料、提取关键数据，再制作一份可下载的报告或表格。先告诉我需要提供哪些资料。", "Help me analyze files, extract the key data, and create a downloadable report or spreadsheet. Start by telling me which files to provide.") },
    { icon: "sparkles", title: t("起草一份文稿", "Draft a document"), description: t("帮我起草一份文稿。先问我主题、读者和用途，再确定大纲并撰写初稿。", "Help me draft a document. Ask about the topic, audience, and purpose, then create an outline and a first draft.") },
  ];
}

export function isPendingRunText(text) {
  return typeof text === "string" && PENDING_RUN_TEXTS.has(text.trim());
}

export function normalizeFallbackToolTimeline(tools, locale) {
  if (!Array.isArray(tools) || tools.length === 0) return [];

  return tools
    .filter((tool) => tool && typeof tool === "object" && typeof tool.id === "string" && tool.id)
    .map((tool) => {
      const apiName = typeof tool.apiName === "string" ? tool.apiName : "";
      const status = tool.status === "error" ? "error" : "done";
      const resultCount = Array.isArray(tool.state?.results) ? tool.state.results.length : undefined;
      const toolIdentifier = normalizeWebBrowsingIdentifier(tool.identifier);

      if (apiName === "search") {
        return {
          id: `timeline_${tool.id}`,
          kind: "search",
          status,
          query: typeof tool.arguments?.query === "string" ? tool.arguments.query : "",
          resultCount,
          message: typeof tool.content === "string" ? tool.content : "",
        };
      }

      if (apiName === "crawlSinglePage" || apiName === "crawlMultiPages") {
        const firstUrl = typeof tool.arguments?.url === "string" && tool.arguments.url
          ? tool.arguments.url
          : (
            Array.isArray(tool.arguments?.urls)
              ? tool.arguments.urls.find((item) => typeof item === "string" && item.trim())
              : ""
          ) || "";

        return {
          id: `timeline_${tool.id}`,
          kind: "reader",
          status,
          url: firstUrl,
          resultCount,
          message: typeof tool.content === "string" ? tool.content : "",
        };
      }

      return {
        id: `timeline_${tool.id}`,
        kind: "tool",
        status,
        content: typeof tool.title === "string" && tool.title
          ? tool.title
          : (isWebBrowsingIdentifier(toolIdentifier) ? getWebBrowsingToolTitle(apiName, locale) : translate(locale, "工具调用", "Tool call")),
        message: typeof tool.content === "string" ? tool.content : "",
      };
    })
    .filter(Boolean);
}
