import { exaContents, exaSearch } from "@/lib/server/search/providers/exa";
import {
  WEB_BROWSING_CRAWL_CONTENT_LIMIT,
  WEB_BROWSING_SEARCH_ITEM_LIMIT,
} from "@/lib/server/webBrowsing/types";

const DEFAULT_CRAWL_CONCURRENCY = 1;

function errorInfo(error, fallbackMessage) {
  const status = Number(error?.status);
  const code = typeof error?.code === "string" ? error.code : "";
  return {
    name: error instanceof Error ? error.name : "ExaError",
    message: error instanceof Error ? error.message : String(error || fallbackMessage),
    ...(Number.isInteger(status) ? { status } : {}),
    ...(code ? { code } : {}),
    ...(error?.details !== undefined ? { details: error.details } : {}),
  };
}

function errorMessage(info) {
  const labels = [
    Number.isInteger(info?.status) ? `HTTP ${info.status}` : "",
    info?.code || "",
  ].filter(Boolean);
  return labels.length > 0
    ? `${info.message}（${labels.join(" / ")}）`
    : info.message;
}

async function mapWithConcurrency(items, worker, concurrency) {
  const list = Array.isArray(items) ? items : [];
  const size = Math.max(1, Number(concurrency) || DEFAULT_CRAWL_CONCURRENCY);
  const results = new Array(list.length);
  let cursor = 0;

  const run = async () => {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(list[index], index);
    }
  };

  await Promise.all(Array.from({ length: Math.min(size, list.length || 1) }, run));
  return results;
}

export class SearchService {
  constructor(options = {}) {
    this.webSearchOptions = options?.webSearchOptions || {};
    this.crawlConcurrency = options?.crawlConcurrency || DEFAULT_CRAWL_CONCURRENCY;
  }

  async webSearch({ query }, options = {}) {
    try {
      const startedAt = Date.now();
      const data = await exaSearch(query, {
        ...this.webSearchOptions,
        signal: options?.signal,
      });
      const results = (Array.isArray(data?.results) ? data.results : []).slice(0, WEB_BROWSING_SEARCH_ITEM_LIMIT);

      return {
        costTime: Date.now() - startedAt,
        query,
        resultNumbers: results.length,
        results,
      };
    } catch (error) {
      const info = errorInfo(error, "Search failed");
      console.error("[WebSearch] Search failed", {
        errorType: info.name,
        errorStatus: info.status,
        errorCode: info.code,
      });
      return {
        costTime: 0,
        error: info,
        errorDetail: errorMessage(info),
        query,
        resultNumbers: 0,
        results: [],
      };
    }
  }

  async crawlPages({ urls }, options = {}) {
    const safeUrls = Array.isArray(urls)
      ? urls.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
      : [];
    const results = await mapWithConcurrency(
      safeUrls,
      async (url) => {
        try {
          const result = await exaContents(url, {
            ...this.webSearchOptions,
            signal: options?.signal,
          });
          if (typeof result?.data?.content === "string") {
            result.data.content = result.data.content.slice(0, WEB_BROWSING_CRAWL_CONTENT_LIMIT);
            result.data.length = result.data.content.length;
          }
          return result;
        } catch (error) {
          const info = errorInfo(error, "Unknown crawl error");
          const message = errorMessage(info);
          console.error("[WebSearch] Scrape failed", {
            errorType: info.name,
            errorStatus: info.status,
            errorCode: info.code,
          });
          return {
            crawler: "exa",
            data: {
              content: message,
              errorMessage: message,
              errorType: info.name,
              errorStatus: info.status,
              errorCode: info.code,
            },
            originalUrl: url,
          };
        }
      },
      this.crawlConcurrency
    );
    return { results };
  }
}
