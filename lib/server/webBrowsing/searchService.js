import { firecrawlScrape, firecrawlSearch } from "@/lib/server/search/providers/firecrawl";
import {
  WEB_BROWSING_CRAWL_CONTENT_LIMIT,
  WEB_BROWSING_SEARCH_ITEM_LIMIT,
} from "@/lib/server/webBrowsing/types";

const DEFAULT_CRAWL_CONCURRENCY = 1;

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
      const data = await firecrawlSearch(query, {
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
      console.error("[WebSearch] Search failed", {
        errorType: error instanceof Error ? error.name : "SearchError",
      });
      return {
        costTime: 0,
        errorDetail: error instanceof Error ? error.message : String(error || "Search failed"),
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
          const result = await firecrawlScrape(url, {
            ...this.webSearchOptions,
            signal: options?.signal,
          });
          if (typeof result?.data?.content === "string") {
            result.data.content = result.data.content.slice(0, WEB_BROWSING_CRAWL_CONTENT_LIMIT);
            result.data.length = result.data.content.length;
          }
          return result;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error || "Unknown crawl error");
          const name = error instanceof Error ? error.name : "FirecrawlScrapeError";
          console.error("[WebSearch] Scrape failed", {
            errorType: name,
          });
          return {
            crawler: "firecrawl",
            data: {
              content: `Fail to crawl the page. Error type: ${name}, error message: ${message}`,
              errorMessage: message,
              errorType: name,
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
