import {
  WEB_BROWSING_CRAWL_CONTENT_LIMIT,
  WEB_BROWSING_SEARCH_ITEM_LIMIT,
} from "@/lib/server/webBrowsing/types";

const TINYFISH_SEARCH_URL = "https://api.search.tinyfish.ai";
const TINYFISH_FETCH_URL = "https://api.fetch.tinyfish.ai";
const SEARCH_TIMEOUT_MS = 30_000;
const FETCH_TIMEOUT_MS = 60_000;
const PAGE_TIMEOUT_MS = 45_000;
const SEARCH_CONTENT_LIMIT = 2_000;

function tinyfishError(message, code, status = 502, name = "TinyFishError") {
  const error = new Error(message);
  error.name = name;
  error.code = code;
  error.status = status;
  return error;
}

function invalidResponse() {
  return tinyfishError("联网服务返回的数据格式无效", "TINYFISH_INVALID_RESPONSE");
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw tinyfishError(`${label}不能为空`, "TINYFISH_INVALID_ARGUMENT", 400);
  }
  return value.trim();
}

function webUrl(value) {
  if (typeof value !== "string" || !value.trim()) throw invalidResponse();
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw invalidResponse();
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw invalidResponse();
  return parsed;
}

function requestError(error, signal, activeSignal) {
  if (signal?.aborted) {
    return tinyfishError("联网请求已取消", "TINYFISH_REQUEST_ABORTED", 499, "AbortError");
  }
  if (activeSignal.reason?.name === "TimeoutError" || error?.name === "TimeoutError") {
    return tinyfishError("联网请求超时", "TINYFISH_REQUEST_TIMEOUT", 504);
  }
  if (error?.name === "AbortError") {
    return tinyfishError("联网请求已取消", "TINYFISH_REQUEST_ABORTED", 499, "AbortError");
  }
  return tinyfishError("无法连接联网服务", "TINYFISH_NETWORK_ERROR");
}

function httpError(status) {
  switch (status) {
    case 400:
    case 422:
      return tinyfishError("联网请求参数无效", "TINYFISH_INVALID_ARGUMENT", status);
    case 401:
      return tinyfishError("联网服务密钥无效，请联系管理员", "TINYFISH_UNAUTHORIZED", status);
    case 402:
      return tinyfishError("当前账号尚未开通联网搜索权限，请联系管理员", "TINYFISH_ACCESS_REQUIRED", status);
    case 403:
      return tinyfishError("联网服务拒绝访问", "TINYFISH_FORBIDDEN", status);
    case 404:
      return tinyfishError("联网服务接口不可用", "TINYFISH_UNAVAILABLE", status);
    case 429:
      return tinyfishError("联网请求过于频繁，请稍后再试", "TINYFISH_RATE_LIMITED", status);
    case 504:
      return tinyfishError("联网请求超时", "TINYFISH_REQUEST_TIMEOUT", status);
    default:
      return tinyfishError("联网服务请求失败", "TINYFISH_UPSTREAM_ERROR", status);
  }
}

async function requestTinyfish(url, { method, body, signal, timeoutMs }) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const activeSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  if (activeSignal.aborted) throw requestError(activeSignal.reason, signal, activeSignal);

  const apiKey = process.env.TINYFISH_API_KEY?.trim();
  if (!apiKey) {
    throw tinyfishError("联网服务尚未配置，请联系管理员", "TINYFISH_NOT_CONFIGURED", 503);
  }

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        "X-API-Key": apiKey,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: activeSignal,
      cache: "no-store",
    });
  } catch (error) {
    throw requestError(error, signal, activeSignal);
  }
  if (!response.ok) {
    try {
      await response.body?.cancel();
    } catch (error) {
      throw requestError(error, signal, activeSignal);
    }
    throw httpError(response.status);
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    if (signal?.aborted || activeSignal.aborted) throw requestError(error, signal, activeSignal);
    throw invalidResponse();
  }
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.results)) {
    throw invalidResponse();
  }
  return payload;
}

export async function tinyfishSearch({ query, language }, { signal } = {}) {
  const request = {
    query: requiredText(query, "搜索内容").slice(0, 400),
    language: requiredText(language, "搜索语言"),
    page: "0",
  };
  const url = new URL(TINYFISH_SEARCH_URL);
  url.search = new URLSearchParams(request).toString();
  const payload = await requestTinyfish(url, { method: "GET", signal, timeoutMs: SEARCH_TIMEOUT_MS });
  const results = payload.results.slice(0, WEB_BROWSING_SEARCH_ITEM_LIMIT).map((item) => {
    if (!item || typeof item.title !== "string" || typeof item.snippet !== "string") {
      throw invalidResponse();
    }
    webUrl(item.url);
    return {
      category: "general",
      content: item.snippet.trim().slice(0, SEARCH_CONTENT_LIMIT),
      title: item.title.trim(),
      url: item.url.trim(),
    };
  });
  return { results };
}

function pageError(failure) {
  if (!failure || typeof failure.error !== "string") throw invalidResponse();
  const messages = {
    target_http_error: "网页服务器返回错误",
    page_not_found: "网页不存在或已被删除",
    target_unreachable: "无法连接目标网页",
    timeout: "网页读取超时",
    bot_blocked: "网页禁止自动访问",
    empty_content: "网页没有可读取的正文",
    login_required: "网页需要登录后才能读取",
    content_too_large: "网页内容过大，无法读取",
    invalid_url: "网页地址不允许访问",
    invalid_redirect_url: "网页跳转后的地址不允许访问",
    proxy_error: "网页访问连接失败",
  };
  if (!Object.hasOwn(messages, failure.error)) throw invalidResponse();
  if (failure.error === "target_http_error" || failure.error === "page_not_found") {
    if (!Number.isInteger(failure.status) || failure.status < 400 || failure.status > 599) {
      throw invalidResponse();
    }
    return tinyfishError(messages[failure.error], failure.error, failure.status);
  }
  return tinyfishError(messages[failure.error], failure.error, failure.error === "timeout" ? 504 : 502);
}

export async function tinyfishFetch(url, { signal } = {}) {
  const targetUrl = requiredText(url, "网页地址");
  const request = {
    urls: [targetUrl],
    format: "markdown",
    ttl: 0,
    per_url_timeout_ms: PAGE_TIMEOUT_MS,
  };
  const payload = await requestTinyfish(TINYFISH_FETCH_URL, {
    method: "POST",
    body: request,
    signal,
    timeoutMs: FETCH_TIMEOUT_MS,
  });
  if (!Array.isArray(payload.errors)) throw invalidResponse();
  const failure = payload.errors.find((item) => item?.url === targetUrl);
  if (failure) throw pageError(failure);
  const result = payload.results.find((item) => item?.url === targetUrl);
  if (!result || typeof result.text !== "string") throw invalidResponse();
  const content = result.text.trim().slice(0, WEB_BROWSING_CRAWL_CONTENT_LIMIT);
  if (!content) throw tinyfishError("网页没有可读取的正文", "TINYFISH_EMPTY_CONTENT");
  const finalUrl = webUrl(result.final_url);
  if (
    (result.title !== null && typeof result.title !== "string")
    || (result.description !== null && typeof result.description !== "string")
  ) {
    throw invalidResponse();
  }
  return {
    crawler: "tinyfish",
    data: {
      content,
      contentType: "text/markdown",
      description: result.description,
      length: content.length,
      siteName: finalUrl.hostname.replace(/^www\./i, ""),
      title: result.title,
      url: finalUrl.href,
    },
    originalUrl: targetUrl,
    status: 200,
  };
}
