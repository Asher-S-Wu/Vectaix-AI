import { translate } from "./i18n.mjs";
export const WebBrowsingApiName = Object.freeze({
  search: "search",
  crawlSinglePage: "crawlSinglePage",
  crawlMultiPages: "crawlMultiPages",
});

export const WEB_BROWSING_IDENTIFIER = "vectaix-web-browsing";

export function isWebBrowsingIdentifier(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized === WEB_BROWSING_IDENTIFIER || normalized.endsWith("-web-browsing");
}

export function normalizeWebBrowsingIdentifier(value) {
  if (isWebBrowsingIdentifier(value)) return WEB_BROWSING_IDENTIFIER;
  return typeof value === "string" ? value.trim() : "";
}

export function getWebBrowsingToolTitle(apiName, locale = "zh") {
  if (apiName === WebBrowsingApiName.search) return translate(locale, "联网搜索", "Web search");
  if (apiName === WebBrowsingApiName.crawlSinglePage) return translate(locale, "浏览网页", "Read webpage");
  if (apiName === WebBrowsingApiName.crawlMultiPages) return translate(locale, "浏览网页", "Read webpage");
  return translate(locale, "联网工具", "Web tools");
}
