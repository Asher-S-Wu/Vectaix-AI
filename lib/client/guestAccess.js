export const GUEST_ACCESS_REFRESH_EVENT = "vectaix-guest-access-refresh";

export function getGuestLinkId() {
  if (typeof window === "undefined") return "";
  const match = /^\/guest\/([^/]+)/.exec(window.location.pathname);
  return match ? decodeURIComponent(match[1]) : "";
}

function firstPartyUrl(value) {
  if (typeof window === "undefined" || !value) return null;
  const url = new URL(value, window.location.origin);
  return url.origin === window.location.origin ? url : null;
}

export async function guestFetch(input, init = {}) {
  const guestId = getGuestLinkId();
  const url = firstPartyUrl(input instanceof Request ? input.url : input);
  if (!guestId || !url?.pathname.startsWith("/api/")) return fetch(input, init);
  const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
  headers.set("X-Guest-Link-Id", guestId);
  const response = await fetch(input, { ...init, headers });
  if ((response.status === 401 || response.status === 403) && !url.pathname.endsWith("/session")) {
    window.dispatchEvent(new Event(GUEST_ACCESS_REFRESH_EVENT));
  }
  return response;
}

export function scopeGuestUrl(value) {
  const guestId = getGuestLinkId();
  if (!guestId || typeof value !== "string") return value;
  const url = firstPartyUrl(value);
  if (!url?.pathname.startsWith("/api/")) return value;
  url.searchParams.set("guestLinkId", guestId);
  return value.startsWith("/") ? `${url.pathname}${url.search}${url.hash}` : url.href;
}

export function guestStorageKey(key) {
  const guestId = getGuestLinkId();
  return guestId ? `vectaix-guest:${guestId}:${key}` : key;
}

export function guestWorkspaceHref(href) {
  const guestId = getGuestLinkId();
  return guestId ? `/guest/${encodeURIComponent(guestId)}${href === "/" ? "" : href}` : href;
}
