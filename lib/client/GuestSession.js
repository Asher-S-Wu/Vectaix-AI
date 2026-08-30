"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { GUEST_ACCESS_REFRESH_EVENT, guestFetch } from "@/lib/client/guestAccess";

const GuestSessionContext = createContext(null);

export function useGuestSession() {
  return useContext(GuestSessionContext);
}

export function GuestSessionProvider({ id, children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const initializationRef = useRef(null);
  const refreshPromiseRef = useRef(null);
  const refresh = useCallback(() => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    refreshPromiseRef.current = guestFetch(`/api/guest/${encodeURIComponent(id)}/session`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.user) throw new Error(data.error || "此分享链接已停用或失效");
        setUser(data.user);
        setError("");
      })
      .catch((reason) => { setUser(null); setError(reason.message || "暂时无法打开此分享链接"); })
      .finally(() => { refreshPromiseRef.current = null; setLoading(false); });
    return refreshPromiseRef.current;
  }, [id]);

  useEffect(() => {
    if (!initializationRef.current) {
      const fragment = window.location.hash.slice(1);
      const key = new URLSearchParams(fragment).get("key");
      if (fragment) window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
      initializationRef.current = key
        ? guestFetch(`/api/guest/${encodeURIComponent(id)}/session`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }),
        }).then(async (response) => {
          const data = await response.json();
          if (!response.ok || !data.user) throw new Error(data.error || "此分享链接已停用或失效");
          setUser(data.user);
          setError("");
        }).catch((reason) => { setUser(null); setError(reason.message || "暂时无法打开此分享链接"); })
          .finally(() => setLoading(false))
        : refresh();
    }
    const onFocus = () => { if (document.visibilityState === "visible") refresh(); };
    const interval = window.setInterval(onFocus, 30_000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener(GUEST_ACCESS_REFRESH_EVENT, refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener(GUEST_ACCESS_REFRESH_EVENT, refresh);
    };
  }, [id, refresh]);

  if (loading || !user) {
    return <main className="grid min-h-dvh place-items-center bg-app px-6 text-zinc-900 dark:text-zinc-100"><div className="max-w-md text-center"><h1 className="text-xl font-semibold">{loading ? "正在打开共享空间…" : "此分享链接暂不可用"}</h1><p className="mt-3 text-sm text-zinc-500">{loading ? "请稍候" : error}</p></div></main>;
  }
  return <GuestSessionContext.Provider value={{ id, user, refresh }}>{children}</GuestSessionContext.Provider>;
}
