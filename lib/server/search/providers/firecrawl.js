import { Firecrawl } from "firecrawl";
import { WEB_SEARCH_LIMIT } from "@/lib/server/chat/webSearchConfig";
import { WEB_SEARCH_MAX_COUNT } from "@/lib/shared/webSearch";

const FIRECRAWL_SEARCH_TIMEOUT_MS = 30000;
const FIRECRAWL_SCRAPE_TIMEOUT_MS = 60000;

function getFirecrawlApiKey() {
  const apiKey = typeof process.env.FIRECRAWL_API_KEY === "string"
    ? process.env.FIRECRAWL_API_KEY.trim()
    : "";
  if (!apiKey) {
    throw new Error("FIRECRAWL_API_KEY is not set");
  }
  return apiKey;
}

function createFirecrawlClient() {
  return new Firecrawl({ apiKey: getFirecrawlApiKey() });
}

function createAbortError() {
  const error = new Error("Firecrawl request aborted");
  error.name = "AbortError";
  return error;
}

async function withTimeout(operation, { signal, timeoutMs, timeoutMessage }) {
  if (signal?.aborted) {
    throw createAbortError();
  }

  let timeoutId = null;
  let abortHandler = null;
  const control = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(timeoutMessage || "Firecrawl request timed out");
      error.name = "TimeoutError";
      reject(error);
    }, timeoutMs);

    if (signal) {
      abortHandler = () => reject(createAbortError());
      signal.addEventListener("abort", abortHandler, { once: true });
    }
  });

  try {
    return await Promise.race([operation(), control]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
  }
}

function normalizeQuery(query) {
  const normalized = typeof query === "string" ? query.trim() : "";
  if (!normalized) {
    throw new Error("Search query is empty");
  }
  return normalized.slice(0, 400);
}

function normalizeSearchLimit() {
  const normalized = Math.max(1, Math.floor(WEB_SEARCH_LIMIT || 20));
  return Math.min(normalized, WEB_SEARCH_MAX_COUNT, 20);
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? score : 0;
}

function toUniformSearchResult(item) {
  const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const url = normalizeText(item?.url || metadata?.url || metadata?.sourceURL);
  return {
    category: normalizeText(item?.category) || "general",
    content: normalizeText(item?.description || item?.markdown || metadata?.description),
    engines: ["firecrawl-search"],
    parsedUrl: url,
    publishedDate: normalizeText(item?.date || metadata?.publishedTime),
    score: normalizeScore(item?.score),
    title: normalizeText(item?.title || metadata?.title) || url,
    url,
  };
}

export async function firecrawlSearch(query, options = {}) {
  const normalizedQuery = normalizeQuery(query);
  const limit = normalizeSearchLimit();
  const client = createFirecrawlClient();
  const payload = await withTimeout(
    () => client.search(normalizedQuery, {
      sources: ["web"],
      limit,
      ignoreInvalidURLs: true,
      timeout: FIRECRAWL_SEARCH_TIMEOUT_MS,
    }),
    {
      signal: options?.signal,
      timeoutMs: FIRECRAWL_SEARCH_TIMEOUT_MS,
      timeoutMessage: "Firecrawl search timed out",
    }
  );

  const items = Array.isArray(payload?.web) ? payload.web : [];
  return {
    payload,
    resolved: { limit, sources: ["web"] },
    results: items.map(toUniformSearchResult).filter((item) => item.url),
  };
}

function extractSiteName(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

export async function firecrawlScrape(url, options = {}) {
  const targetUrl = normalizeText(url);
  if (!targetUrl) {
    throw new Error("Scrape url is empty");
  }

  const client = createFirecrawlClient();
  const document = await withTimeout(
    () => client.scrape(targetUrl, {
      formats: ["markdown"],
      onlyMainContent: true,
      removeBase64Images: true,
      blockAds: true,
      maxAge: 0,
      timeout: FIRECRAWL_SCRAPE_TIMEOUT_MS,
    }),
    {
      signal: options?.signal,
      timeoutMs: FIRECRAWL_SCRAPE_TIMEOUT_MS,
      timeoutMessage: "Firecrawl scrape timed out",
    }
  );

  const content = normalizeText(document?.markdown);
  if (!content) {
    throw new Error(normalizeText(document?.warning || document?.metadata?.error) || "Firecrawl scrape returned no markdown");
  }

  const metadata = document?.metadata && typeof document.metadata === "object" ? document.metadata : {};
  const finalUrl = normalizeText(metadata?.url || metadata?.ogUrl || metadata?.sourceURL) || targetUrl;
  const status = Number(metadata?.statusCode);
  return {
    crawler: "firecrawl",
    resolved: {
      formats: ["markdown"],
      onlyMainContent: true,
      maxAge: 0,
    },
    data: {
      content,
      contentType: normalizeText(metadata?.contentType) || "text/markdown",
      description: normalizeText(metadata?.description || metadata?.ogDescription),
      length: content.length,
      siteName: normalizeText(metadata?.ogSiteName) || extractSiteName(finalUrl),
      title: normalizeText(metadata?.title || metadata?.ogTitle) || finalUrl,
      url: finalUrl,
    },
    originalUrl: targetUrl,
    status: Number.isFinite(status) ? status : 200,
  };
}
