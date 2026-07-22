"use client";

import { useEffect } from "react";

// Opts the page out of the global mobile scroll lock (chat-page keyboard hack)
// by toggling a class on <html> while mounted.
export default function PageScrollUnlock() {
  useEffect(() => {
    document.documentElement.classList.add("allow-page-scroll");
    return () => document.documentElement.classList.remove("allow-page-scroll");
  }, []);
  return null;
}
