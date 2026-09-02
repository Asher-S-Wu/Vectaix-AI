import { WEB_SEARCH_LIMIT } from "@/lib/server/chat/webSearchConfig";
import { WEB_SEARCH_MAX_COUNT } from "@/lib/shared/webSearch";
import { WEB_BROWSING_CRAWL_CONTENT_LIMIT } from "@/lib/server/webBrowsing/types";

const EXA_API_ROOT = "https://api.exa.ai";
const EXA_SEARCH_TIMEOUT_MS = 30_000;
const EXA_CONTENTS_TIMEOUT_MS = 60_000;
const EXA_LIVE_CRAWL_TIMEOUT_MS = 15_000;
const EXA_SEARCH_HIGHLIGHT_MAX_CHARACTERS = 1_200;
const EXA_SEARCH_CONTENT_MAX_CHARACTERS = 2_000;

function getExaApiKey() {
  const apiKey = typeof process.env.EXA_API_KEY === "string"
    ? process.env.EXA_API_KEY.trim()
    : "";
  if (!apiKey) throw new Error("EXA_API_KEY is not set");
  return apiKey;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeQuery(query) {
  const normalized = normalizeText(query);
  if (!normalized) throw new Error("Search query is empty");
  return normalized.slice(0, 400);
}

function normalizeSearchLimit() {
  const normalized = Math.max(1, Math.floor(WEB_SEARCH_LIMIT || 20));
  return Math.min(normalized, WEB_SEARCH_MAX_COUNT, 20);
}

function requestSignal(signal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

function createExaError(message, {
  status = 502,
  code = "EXA_REQUEST_FAILED",
  name = "ExaError",
} = {}) {
  const error = new Error(message);
  error.name = name;
  error.status = status;
  error.code = code;
  return error;
}

function readErrorMessage(payload, fallback) {
  const error = payload?.error;
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object") {
    const message = normalizeText(error.message || error.tag);
    if (message) return message;
  }
  return normalizeText(payload?.message) || fallback;
}

function readErrorCode(payload, fallback) {
  const error = payload?.error;
  if (error && typeof error === "object") {
    return normalizeText(error.code || error.tag || payload?.code || payload?.tag) || fallback;
  }
  return normalizeText(payload?.code || payload?.tag) || fallback;
}

function requestError(error, { signal, activeSignal }) {
  if (signal?.aborted) {
    return createExaError("Exa request aborted", {
      status: 499,
      code: "EXA_REQUEST_ABORTED",
      name: "AbortError",
    });
  }
  if (
    error?.name === "TimeoutError"
    || (activeSignal?.aborted && activeSignal.reason?.name === "TimeoutError")
  ) {
    return createExaError("Exa request timed out", {
      status: 504,
      code: "EXA_REQUEST_TIMEOUT",
    });
  }
  if (error?.name === "AbortError") {
    return createExaError("Exa request aborted", {
      status: 499,
      code: "EXA_REQUEST_ABORTED",
      name: "AbortError",
    });
  }
  return createExaError("Unable to connect to Exa", {
    status: 502,
    code: "EXA_NETWORK_ERROR",
  });
}

async function postExa(pathname, body, { signal, timeoutMs, onRequestState }) {
  const apiKey = getExaApiKey();
  const activeSignal = requestSignal(signal, timeoutMs);
  const requestBody = JSON.stringify(body);
  if (activeSignal.aborted) {
    throw requestError(activeSignal.reason, { signal, activeSignal });
  }
  let response;
  try {
    const request = fetch(`${EXA_API_ROOT}${pathname}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: requestBody,
      signal: activeSignal,
    });
    onRequestState?.("dispatched");
    response = await request;
  } catch (error) {
    onRequestState?.("uncertain");
    throw requestError(error, { signal, activeSignal });
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    onRequestState?.(response.ok ? "uncertain" : "rejected");
    if (
      signal?.aborted
      || activeSignal.aborted
      || error?.name === "AbortError"
      || error?.name === "TimeoutError"
    ) {
      throw requestError(error, { signal, activeSignal });
    }
    throw createExaError("Exa returned an invalid response", {
      status: response.ok ? 502 : response.status,
      code: "EXA_INVALID_RESPONSE",
    });
  }

  if (!response.ok || payload?.error) {
    onRequestState?.("rejected");
    throw createExaError(readErrorMessage(payload, "Exa request failed"), {
      status: response.ok ? 502 : response.status,
      code: readErrorCode(payload, "EXA_UPSTREAM_ERROR"),
    });
  }
  onRequestState?.("confirmed");
  return payload;
}

function searchContent(item) {
  const highlights = Array.isArray(item?.highlights)
    ? item.highlights.map(normalizeText).filter(Boolean).join("\n\n")
    : "";
  return (highlights || normalizeText(item?.text)).slice(0, EXA_SEARCH_CONTENT_MAX_CHARACTERS);
}

function toUniformSearchResult(item) {
  const url = normalizeText(item?.url);
  return {
    category: "general",
    content: searchContent(item),
    title: normalizeText(item?.title) || url,
    url,
  };
}

export async function exaSearch(query, options = {}) {
  const normalizedQuery = normalizeQuery(query);
  const limit = normalizeSearchLimit();
  const request = {
    query: normalizedQuery,
    type: "auto",
    numResults: limit,
    contents: {
      highlights: {
        maxCharacters: EXA_SEARCH_HIGHLIGHT_MAX_CHARACTERS,
      },
    },
  };
  const payload = await postExa("/search", request, {
    signal: options?.signal,
    timeoutMs: EXA_SEARCH_TIMEOUT_MS,
    onRequestState: options?.onRequestState,
  });
  const items = Array.isArray(payload?.results) ? payload.results : [];
  return {
    payload,
    resolved: request,
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

function contentsStatusError(status) {
  const upstream = status?.error && typeof status.error === "object" ? status.error : {};
  const httpStatus = Number(upstream.httpStatusCode);
  return createExaError(
    normalizeText(upstream.message || upstream.tag) || "Exa could not read this page",
    {
      status: Number.isInteger(httpStatus) && httpStatus >= 400 && httpStatus <= 599
        ? httpStatus
        : 502,
      code: normalizeText(upstream.tag) || "EXA_CONTENTS_ERROR",
    },
  );
}

export async function exaContents(url, options = {}) {
  const targetUrl = normalizeText(url);
  if (!targetUrl) throw new Error("Contents url is empty");

  const request = {
    urls: [targetUrl],
    text: {
      maxCharacters: WEB_BROWSING_CRAWL_CONTENT_LIMIT,
      verbosity: "standard",
    },
    maxAgeHours: 0,
    livecrawlTimeout: EXA_LIVE_CRAWL_TIMEOUT_MS,
  };
  const payload = await postExa("/contents", request, {
    signal: options?.signal,
    timeoutMs: EXA_CONTENTS_TIMEOUT_MS,
    onRequestState: options?.onRequestState,
  });
  const status = Array.isArray(payload?.statuses) ? payload.statuses[0] : null;
  if (!status) {
    throw createExaError("Exa returned no page status", {
      code: "EXA_INVALID_CONTENTS_RESPONSE",
    });
  }
  if (status.status !== "success") throw contentsStatusError(status);

  const result = Array.isArray(payload?.results) ? payload.results[0] : null;
  const content = normalizeText(result?.text);
  if (!result || !content) {
    throw createExaError("Exa returned no page content", {
      code: "EXA_EMPTY_CONTENTS_RESPONSE",
    });
  }

  const finalUrl = normalizeText(result.url) || targetUrl;
  return {
    crawler: "exa",
    resolved: request,
    data: {
      content,
      contentType: "text/markdown",
      description: "",
      length: content.length,
      siteName: extractSiteName(finalUrl),
      title: normalizeText(result.title) || finalUrl,
      url: finalUrl,
    },
    originalUrl: targetUrl,
    status: 200,
  };
}
