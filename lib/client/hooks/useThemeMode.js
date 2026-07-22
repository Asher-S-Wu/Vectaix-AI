"use client";

import { useEffect, useState } from "react";

export function useThemeMode(themeMode) {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const updateTheme = () => {
      if (themeMode === "system") {
        setIsDark(window.matchMedia("(prefers-color-scheme: dark)").matches);
      } else {
        setIsDark(themeMode === "dark");
      }
    };

    updateTheme();

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (themeMode === "system") updateTheme();
    };
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, [themeMode]);

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add("dark-mode");
      document.body.classList.add("dark-mode");
      root.style.colorScheme = "dark";
      root.style.backgroundColor = "#09090b";
    } else {
      root.classList.remove("dark-mode");
      document.body.classList.remove("dark-mode");
      root.style.colorScheme = "light";
      root.style.backgroundColor = "#ffffff";
    }
  }, [isDark]);
}


