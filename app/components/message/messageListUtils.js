import {
  getWebBrowsingToolTitle,
  isWebBrowsingIdentifier,
  normalizeWebBrowsingIdentifier,
} from "@/lib/shared/webBrowsing";

const PENDING_RUN_TEXTS = new Set(["正在处理中…", "Fusion 正在处理中…"]);

export const STARTER_PROMPTS = [
  { icon: "💡", title: "创意写作", description: "帮我写一个关于火星移民的科幻短篇开头" },
  { icon: "💻", title: "代码助手", description: "用 React 写一个带防抖功能的搜索框组件" },
  { icon: "🌍", title: "旅行规划", description: "制定一份去京都的 5 天文化深度游计划" },
  { icon: "📊", title: "数据分析", description: "如何通俗易懂地解释什么是“量化宽松”？" },
];

export function isPendingRunText(text) {
  return typeof text === "string" && PENDING_RUN_TEXTS.has(text.trim());
}

export function normalizeFallbackToolTimeline(tools) {
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
          : (isWebBrowsingIdentifier(toolIdentifier) ? getWebBrowsingToolTitle(apiName) : "工具调用"),
        message: typeof tool.content === "string" ? tool.content : "",
      };
    })
    .filter(Boolean);
}
