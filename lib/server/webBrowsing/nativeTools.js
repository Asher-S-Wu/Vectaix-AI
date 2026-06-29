import { WebBrowsingExecutionRuntime } from "@/lib/server/webBrowsing/executionRuntime";
import { SearchService } from "@/lib/server/webBrowsing/searchService";
import {
  WEB_BROWSING_MAX_CRAWL_URLS,
  WEB_BROWSING_MAX_ROUNDS,
  WEB_BROWSING_MAX_TOOL_CALLS_PER_ROUND,
  WEB_BROWSING_IDENTIFIER,
  WEB_BROWSING_SEARCH_ITEM_LIMIT,
  WebBrowsingApiName,
} from "@/lib/server/webBrowsing/types";

function buildSearchParameters() {
  return {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query in the user's language.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  };
}

function buildCrawlSingleParameters() {
  return {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Exactly one URL to fetch and read.",
      },
    },
    required: ["url"],
    additionalProperties: false,
  };
}

export function createWebBrowsingRuntime({ webSearchOptions } = {}) {
  return new WebBrowsingExecutionRuntime({
    searchService: new SearchService({ webSearchOptions }),
  });
}

function buildSharedToolDefinitions(apiNames) {
  const toolDefinitions = [
    {
      name: WebBrowsingApiName.search,
      description: "Search the web for fresh information. One answer may use at most five rounds. Each round may search once, then optionally read one webpage from that search. Return at most one tool call in each response.",
      parameters: buildSearchParameters(),
    },
    {
      name: WebBrowsingApiName.crawlSinglePage,
      description: "Read exactly one webpage from the latest search results when an official source or exact page needs deeper inspection.",
      parameters: buildCrawlSingleParameters(),
    },
  ];
  if (!Array.isArray(apiNames)) return toolDefinitions;
  const allowedApiNames = new Set(apiNames);
  return toolDefinitions.filter((tool) => allowedApiNames.has(tool.name));
}

export function getChatCompletionWebTools(apiNames) {
  return buildSharedToolDefinitions(apiNames).map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function normalizeSearchArguments(input) {
  const args = input && typeof input === "object" ? input : {};
  return {
    query: typeof args.query === "string" ? args.query.trim() : "",
  };
}

function normalizeCrawlSingleArguments(input) {
  const args = input && typeof input === "object" ? input : {};
  return {
    url: typeof args.url === "string" ? args.url.trim() : "",
  };
}

function normalizeCrawlMultiArguments(input) {
  const args = input && typeof input === "object" ? input : {};
  return {
    urls: Array.isArray(args.urls)
      ? args.urls
        .filter((item) => typeof item === "string" && item.trim())
        .map((item) => item.trim())
        .slice(0, WEB_BROWSING_MAX_CRAWL_URLS)
      : [],
  };
}

function buildEventSearchResults(results) {
  if (!Array.isArray(results)) return [];
  return results
    .slice(0, WEB_BROWSING_SEARCH_ITEM_LIMIT)
    .map((item) => ({
      url: item?.url || "",
      title: item?.title || item?.url || "",
      datePublished: item?.publishedDate || "",
      siteName: (() => {
        try {
          return new URL(item?.url || "").hostname.replace(/^www\./i, "");
        } catch {
          return "";
        }
      })(),
    }))
    .filter((item) => item.url);
}

function buildEventPageResults(results) {
  if (!Array.isArray(results)) return [];
  return results
    .slice(0, WEB_BROWSING_SEARCH_ITEM_LIMIT)
    .map((item) => {
      const data = item?.data || {};
      return {
        title: data?.title || item?.originalUrl || "",
        url: data?.url || item?.originalUrl || "",
        errorMessage: data?.errorMessage || "",
      };
    })
    .filter((item) => item.url || item.errorMessage);
}

function pushSearchCitations(pushCitations, state) {
  if (typeof pushCitations !== "function") return;
  const citations = Array.isArray(state?.results)
    ? state.results
      .filter((item) => item?.url)
      .map((item) => ({
        url: item.url,
        title: item.title || item.url,
        cited_text: typeof item?.content === "string" ? item.content : "",
      }))
    : [];
  if (citations.length > 0) pushCitations(citations);
}

function pushCrawlCitations(pushCitations, state) {
  if (typeof pushCitations !== "function") return;
  const citations = Array.isArray(state?.results)
    ? state.results
      .map((item) => {
        const data = item?.data || {};
        const url = data?.url || item?.originalUrl || "";
        if (!url) return null;
        return {
          url,
          title: data?.title || url,
          cited_text: typeof data?.content === "string" ? data.content : "",
        };
      })
      .filter(Boolean)
    : [];
  if (citations.length > 0) pushCitations(citations);
}

function buildToolRecord({ apiName, args, result }) {
  return {
    id: `${WEB_BROWSING_IDENTIFIER}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    identifier: WEB_BROWSING_IDENTIFIER,
    apiName,
    arguments: args,
    type: "builtin",
    status: result?.success === false ? "error" : "success",
    content: typeof result?.content === "string" ? result.content : "",
    state: result?.state,
  };
}

function parseArguments(argumentsInput) {
  if (typeof argumentsInput === "string") {
    try {
      return JSON.parse(argumentsInput);
    } catch {
      return {};
    }
  }
  return argumentsInput && typeof argumentsInput === "object" ? argumentsInput : {};
}

export async function executeWebBrowsingNativeToolCall({
  apiName,
  argumentsInput,
  runtime,
  sendEvent,
  pushCitations,
  round = 1,
  signal,
}) {
  const rawArgs = parseArguments(argumentsInput);

  if (apiName === WebBrowsingApiName.search) {
    const args = normalizeSearchArguments(rawArgs);
    sendEvent?.({ type: "search_start", round, query: args.query });
    const result = await runtime.search(args, { signal });
    if (result.success) {
      pushSearchCitations(pushCitations, result.state);
      sendEvent?.({
        type: "search_result",
        round,
        query: args.query,
        results: buildEventSearchResults(result.state?.results),
      });
    } else {
      sendEvent?.({
        type: "search_error",
        round,
        query: args.query,
        message: result?.content || "联网搜索失败",
      });
    }
    return {
      args,
      result,
      toolRecord: buildToolRecord({ apiName, args, result }),
      outputText: typeof result?.content === "string" ? result.content : "",
    };
  }

  if (apiName === WebBrowsingApiName.crawlSinglePage || apiName === WebBrowsingApiName.crawlMultiPages) {
    const args = apiName === WebBrowsingApiName.crawlSinglePage
      ? normalizeCrawlSingleArguments(rawArgs)
      : normalizeCrawlMultiArguments(rawArgs);
    const urls = apiName === WebBrowsingApiName.crawlSinglePage ? [args.url] : args.urls;
    sendEvent?.({
      type: "page_fetch_start",
      round,
      urls,
      url: urls[0] || "",
    });
    const result = apiName === WebBrowsingApiName.crawlSinglePage
      ? await runtime.crawlSinglePage(args, { signal })
      : await runtime.crawlMultiPages(args, { signal });
    if (result.success) {
      pushCrawlCitations(pushCitations, result.state);
      sendEvent?.({
        type: "page_fetch_result",
        round,
        urls,
        url: urls[0] || "",
        results: buildEventPageResults(result.state?.results),
      });
    } else {
      sendEvent?.({
        type: "page_fetch_error",
        round,
        urls,
        url: urls[0] || "",
        message: result?.content || "页面抓取失败",
      });
    }
    return {
      args,
      result,
      toolRecord: buildToolRecord({ apiName, args, result }),
      outputText: typeof result?.content === "string" ? result.content : "",
    };
  }

  return {
    args: {},
    result: {
      success: false,
      content: `Unsupported tool: ${apiName || "unknown"}`,
      state: null,
    },
    toolRecord: buildToolRecord({
      apiName,
      args: {},
      result: {
        success: false,
        content: `Unsupported tool: ${apiName || "unknown"}`,
        state: null,
      },
    }),
    outputText: `Unsupported tool: ${apiName || "unknown"}`,
  };
}

export {
  WEB_BROWSING_MAX_ROUNDS,
  WEB_BROWSING_MAX_TOOL_CALLS_PER_ROUND,
};
