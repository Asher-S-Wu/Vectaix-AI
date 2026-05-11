import {
  getWebBrowsingToolTitle,
  isWebBrowsingIdentifier,
  normalizeWebBrowsingIdentifier,
} from "@/lib/shared/webBrowsing";

const PENDING_RUN_TEXTS = new Set(["正在处理中...", "Council 正在处理中..."]);

export const STARTER_PROMPTS = [
  { icon: "💡", title: "创意写作", description: "帮我写一个关于火星移民的科幻短篇开头" },
  { icon: "💻", title: "代码助手", description: "用 React 写一个带防抖功能的搜索框组件" },
  { icon: "🌍", title: "旅行规划", description: "制定一份去京都的 5 天文化深度游计划" },
  { icon: "📊", title: "数据分析", description: "如何通俗易懂地解释什么是‘量化宽松’？" },
];

export function containsMarkdownTable(text) {
  if (typeof text !== "string") return false;
  const normalized = text.replace(/\r\n/g, "\n");
  return /\|.*\|[\t ]*\n[\t ]*\|?[\t ]*:?-{3,}:?[\t ]*(\|[\t ]*:?-{3,}:?[\t ]*)+\|?/u.test(normalized);
}

export function isPendingRunText(text) {
  return typeof text === "string" && PENDING_RUN_TEXTS.has(text.trim());
}

export function getFirstImagePart(msg) {
  if (!Array.isArray(msg?.parts)) return null;
  return msg.parts.find((part) => typeof part?.inlineData?.url === "string" && part.inlineData.url) || null;
}

function getImageExtensionFromType(mimeType) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  return "png";
}

export function buildImageDownloadName(part) {
  const mimeType = typeof part?.inlineData?.mimeType === "string" ? part.inlineData.mimeType : "image/png";
  return `vectaix-ai-image.${getImageExtensionFromType(mimeType)}`;
}

export async function copyImageToClipboard(part) {
  const imageUrl = part?.inlineData?.url;
  if (!imageUrl) throw new Error("图片地址不存在");
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("当前浏览器不支持复制图片");
  }

  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error("读取图片失败");

  const blob = await response.blob();
  const mimeType = blob.type || part?.inlineData?.mimeType || "image/png";
  const imageBlob = blob.type ? blob : blob.slice(0, blob.size, mimeType);
  await navigator.clipboard.write([
    new ClipboardItem({ [mimeType]: imageBlob }),
  ]);
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
          : (isWebBrowsingIdentifier(toolIdentifier) ? getWebBrowsingToolTitle(apiName) : `${toolIdentifier || "tool"}.${tool.apiName || "run"}`),
        message: typeof tool.content === "string" ? tool.content : "",
      };
    })
    .filter(Boolean);
}
