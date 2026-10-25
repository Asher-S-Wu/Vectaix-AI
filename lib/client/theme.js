"use client";

import { useEffect, useSyncExternalStore } from 'react';
import { MotionConfig } from 'framer-motion';
import { UI_THEME_MODE_KEY } from '@/lib/shared/storageKeys';

const THEME_EVENT = 'huajuan-theme-change';
const MODES = ['system', 'light', 'dark'];

function readTheme() {
  const saved = localStorage.getItem(UI_THEME_MODE_KEY);
  return MODES.includes(saved) ? saved : 'system';
}

export function setThemePreference(mode) {
  if (!MODES.includes(mode)) throw new TypeError('Invalid theme mode.');
  localStorage.setItem(UI_THEME_MODE_KEY, mode);
  window.dispatchEvent(new Event(THEME_EVENT));
}

function subscribe(callback) {
  const storage = event => { if (event.key === UI_THEME_MODE_KEY || event.key === null) callback(); };
  window.addEventListener(THEME_EVENT, callback);
  window.addEventListener('storage', storage);
  return () => {
    window.removeEventListener(THEME_EVENT, callback);
    window.removeEventListener('storage', storage);
  };
}

export function useThemePreference() {
  const themeMode = useSyncExternalStore(subscribe, readTheme, () => 'system');
  return { themeMode, setThemeMode: setThemePreference };
}

export function AppearanceProvider({ children }) {
  const { themeMode } = useThemePreference();
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const mode = readTheme();
      const dark = mode === 'dark' || (mode === 'system' && query.matches);
      const color = dark ? '#111815' : '#ffffff';
      const root = document.documentElement;
      root.classList.toggle('dark-mode', dark);
      root.style.colorScheme = dark ? 'dark' : 'light';
      root.style.backgroundColor = color;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
    };
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [themeMode]);
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
