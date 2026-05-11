"use client";

import { useEffect } from "react";

export default function FadeScrollbarGlobal() {
  useEffect(() => {
    const timers = new WeakMap();

    function onScroll(e) {
      const el = e.target;
      if (!(el instanceof HTMLElement) || !el.classList.contains("fade-scrollbar")) return;
      el.classList.add("is-scrolling");
      clearTimeout(timers.get(el));
      timers.set(el, setTimeout(() => el.classList.remove("is-scrolling"), 800));
    }

    document.addEventListener("scroll", onScroll, true);
    return () => document.removeEventListener("scroll", onScroll, true);
  }, []);

  return null;
}
