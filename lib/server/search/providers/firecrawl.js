import { Firecrawl } from "firecrawl";
import { WEB_SEARCH_LIMIT } from "@/lib/server/chat/webSearchConfig";
import { WEB_SEARCH_MAX_COUNT } from "@/lib/shared/webSearch";

const FIRECRAWL_SEARCH_TIMEOUT_MS = 30000;
const FIRECRAWL_SCRAPE_TIMEOUT_MS = 60000;
const FIRECRAWL_MAX_ATTEMPTS = 3;
const FIRECRAWL_RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const FIRECRAWL_RETRYABLE_CODES = new Set([
  "ECONNABORTED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

let firecrawlClient = null;

function getFirecrawlApiKey() {
  const apiKey = typeof process.env.FIRECRAWL_API_KEY === "string"
    ? process.env.FIRECRAWL_API_KEY.trim()
    : "";
  if (!apiKey) {
    throw new Error("FIRECRAWL_API_KEY is not set");
  }
  return apiKey;
}

function getFirecrawlClient() {
  if (firecrawlClient) return firecrawlClient;

  const apiUrl = typeof process.env.FIRECRAWL_API_URL === "string"
    ? process.env.FIRECRAWL_API_URL.trim()
    : "";
  firecrawlClient = new Firecrawl({
    apiKey: getFirecrawlApiKey(),
    ...(apiUrl ? { apiUrl } : {}),
    maxRetries: 1,
  });
  return firecrawlClient;
}

function createAbortError() {
  const error = new Error("Firecrawl request aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function firecrawlErrorStatus(error) {
  const status = Number(error?.status);
  return Number.isInteger(status) ? status : null;
}

function firecrawlErrorCode(error) {
  return typeof error?.code === "string" ? error.code.toUpperCase() : "";
}

function isRetryableFirecrawlError(error) {
  const status = firecrawlErrorStatus(error);
  if (status !== null) return FIRECRAWL_RETRYABLE_STATUSES.has(status);
  return FIRECRAWL_RETRYABLE_CODES.has(firecrawlErrorCode(error));
}

function retryDelayMs(attempt) {
  return Math.min(2 ** attempt, 30) * 1000 + Math.floor(Math.random() * 1000);
}

function waitForRetry(delayMs, signal) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", abortHandler);
      resolve();
    }, delayMs);
    const abortHandler = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", abortHandler);
      reject(createAbortError());
    };
    signal?.addEventListener("abort", abortHandler, { once: true });
  });
}

async function runFirecrawlRequest(operation, { signal } = {}) {
  let lastError = null;

  for (let attempt = 0; attempt < FIRECRAWL_MAX_ATTEMPTS; attempt += 1) {
    throwIfAborted(signal);
    try {
      const result = await operation();
      throwIfAborted(signal);
      return result;
    } catch (error) {
      if (signal?.aborted) throw createAbortError();
      lastError = error;
      const shouldRetry = attempt < FIRECRAWL_MAX_ATTEMPTS - 1
        && isRetryableFirecrawlError(error);
      if (!shouldRetry) throw error;
      await waitForRetry(retryDelayMs(attempt), signal);
    }
  }

  throw lastError;
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

function toUniformSearchResult(item) {
  const url = normalizeText(item?.url);
  return {
    category: normalizeText(item?.category) || "general",
    content: normalizeText(item?.description),
    title: normalizeText(item?.title) || url,
    url,
  };
}

export async function firecrawlSearch(query, options = {}) {
  const normalizedQuery = normalizeQuery(query);
  const limit = normalizeSearchLimit();
  const client = getFirecrawlClient();
  const payload = await runFirecrawlRequest(
    () => client.search(normalizedQuery, {
      sources: ["web"],
      limit,
      ignoreInvalidURLs: true,
      timeout: FIRECRAWL_SEARCH_TIMEOUT_MS,
    }),
    {
      signal: options?.signal,
    }
  );

  const items = Array.isArray(payload?.web) ? payload.web : [];
  return {
    payload,
    resolved: {
      sources: ["web"],
      limit,
      ignoreInvalidURLs: true,
      timeout: FIRECRAWL_SEARCH_TIMEOUT_MS,
    },
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

  const client = getFirecrawlClient();
  const document = await runFirecrawlRequest(
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
      removeBase64Images: true,
      blockAds: true,
      maxAge: 0,
      timeout: FIRECRAWL_SCRAPE_TIMEOUT_MS,
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
