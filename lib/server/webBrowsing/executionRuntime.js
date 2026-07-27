import { crawlResultsPrompt } from "@/lib/server/webBrowsing/crawlResultsPrompt";
import { searchResultsPrompt } from "@/lib/server/webBrowsing/searchResultsPrompt";
import {
  WEB_BROWSING_CRAWL_CONTENT_LIMIT,
  WEB_BROWSING_SEARCH_ITEM_LIMIT,
} from "@/lib/server/webBrowsing/types";

function normalizeComparableUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

export class WebBrowsingExecutionRuntime {
  constructor(options = {}) {
    this.searchService = options?.searchService;
    this.latestSearchUrls = new Set();
  }

  async search(args, options = {}) {
    try {
      const data = await this.searchService.webSearch(args || {}, options);

      if (data?.errorDetail) {
        this.latestSearchUrls = new Set();
        return {
          content: data.errorDetail,
          error: data.error || { message: data.errorDetail },
          state: data,
          success: false,
        };
      }

      const searchContent = Array.isArray(data?.results)
        ? data.results.slice(0, WEB_BROWSING_SEARCH_ITEM_LIMIT).map((item) => ({
          title: item.title,
          url: item.url,
          ...(item.content ? { content: item.content } : {}),
          ...(item.imgSrc ? { imgSrc: item.imgSrc } : {}),
          ...(item.thumbnail ? { thumbnail: item.thumbnail } : {}),
        }))
        : [];
      this.latestSearchUrls = new Set(
        searchContent.map((item) => normalizeComparableUrl(item.url)).filter(Boolean)
      );

      return {
        content: searchResultsPrompt(searchContent),
        state: data,
        success: true,
      };
    } catch (error) {
      this.latestSearchUrls = new Set();
      return {
        content: error instanceof Error ? error.message : String(error || "Search failed"),
        error,
        success: false,
      };
    }
  }

  async crawlSinglePage(args, options = {}) {
    const url = typeof args?.url === "string" ? args.url : "";
    return this.crawlMultiPages({ urls: url ? [url] : [] }, options);
  }

  async crawlMultiPages(args, options = {}) {
    const requestedUrls = Array.isArray(args?.urls)
      ? args.urls.filter((url) => typeof url === "string" && url.trim())
      : [];
    const invalidUrls = requestedUrls.filter((url) => {
      const normalized = normalizeComparableUrl(url);
      return !normalized || !this.latestSearchUrls.has(normalized);
    });
    if (requestedUrls.length === 0 || invalidUrls.length > 0) {
      const message = requestedUrls.length === 0
        ? "没有提供需要读取的网页地址"
        : "只能读取本轮搜索结果中出现的网页地址";
      return {
        content: message,
        error: { message, code: "URL_NOT_IN_LATEST_SEARCH_RESULTS" },
        state: { results: [] },
        success: false,
      };
    }

    const response = await this.searchService.crawlPages({
      urls: requestedUrls,
    }, options);

    const content = Array.isArray(response?.results)
      ? response.results.map((item) => {
        const data = item?.data || {};
        if (data?.errorMessage) {
          return {
            errorMessage: data.errorMessage,
            errorType: data.errorType || "FetchError",
            url: item?.originalUrl || "",
          };
        }

        return {
          content: typeof data?.content === "string"
            ? data.content.slice(0, WEB_BROWSING_CRAWL_CONTENT_LIMIT)
            : "",
          contentType: data?.contentType || "text",
          description: data?.description || "",
          length: Number.isFinite(data?.length) ? data.length : undefined,
          siteName: data?.siteName || "",
          title: data?.title || item?.originalUrl || "",
          url: data?.url || item?.originalUrl || "",
        };
      })
      : [];

    const successCount = content.filter((item) => !item?.errorMessage).length;
    const failureItems = content.filter((item) => item?.errorMessage);

    if (failureItems.length > 0 && successCount === 0) {
      const failureMessage = failureItems.length === 1
        ? (failureItems[0].errorMessage || "页面抓取失败")
        : `页面抓取全部失败（共 ${failureItems.length} 页）`;
      return {
        content: failureMessage,
        error: { message: failureMessage },
        state: response,
        success: false,
      };
    }

    return {
      content: crawlResultsPrompt(content),
      state: response,
      success: true,
    };
  }
}
