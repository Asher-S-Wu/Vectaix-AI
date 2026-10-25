"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  UI_COMPLETION_SOUND_VOLUME_KEY,
  UI_FONT_SIZE_KEY,
  UI_THEME_MODE_KEY,
  UI_WEB_SEARCH_KEY,
} from "@/lib/shared/storageKeys";
import { DEFAULT_ASSISTANT } from "@/lib/shared/preferences.mjs";
import { apiJson } from "@/lib/client/apiClient";
import { setThemePreference } from '@/lib/client/theme';
import {
  readLocalJson,
  readLocalSetting,
  writeLocalJson,
  writeLocalSetting,
} from "@/lib/client/localSettings";
import { DEFAULT_WEB_SEARCH_SETTINGS, normalizeWebSearchSettings } from "@/lib/shared/webSearch";

const DEFAULT_COMPLETION_SOUND_VOLUME = 60;


export function useUserSettings() {
  const [assistant, setAssistant] = useState(DEFAULT_ASSISTANT);
  const [isSettingsReady, setIsSettingsReady] = useState(false);
  const [themeMode, _setThemeMode] = useState("system");
  const [fontSize, _setFontSize] = useState("medium");
  const [webSearch, _setWebSearch] = useState(DEFAULT_WEB_SEARCH_SETTINGS);
  const [avatar, _setAvatar] = useState(null);
  const [nickname, _setNickname] = useState("");
  const [chatSystemPrompt, _setChatSystemPrompt] = useState("");
  const [completionSoundVolume, _setCompletionSoundVolume] = useState(DEFAULT_COMPLETION_SOUND_VOLUME);
  const [settingsError, setSettingsError] = useState(null);
  const settingsRequestRef = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      const localTheme = readLocalSetting(UI_THEME_MODE_KEY);
      const localFont = readLocalSetting(UI_FONT_SIZE_KEY);
      const localWebSearch = readLocalJson(UI_WEB_SEARCH_KEY);
      const localCompletionSoundVolume = readLocalSetting(UI_COMPLETION_SOUND_VOLUME_KEY);

      if (typeof localTheme === "string") _setThemeMode(localTheme);
      if (typeof localFont === "string") _setFontSize(localFont);
      _setWebSearch(normalizeWebSearchSettings(localWebSearch, { defaultEnabled: true }));
      if (localCompletionSoundVolume !== null) {
        const parsed = Number(localCompletionSoundVolume);
        _setCompletionSoundVolume(Number.isFinite(parsed) ? parsed : DEFAULT_COMPLETION_SOUND_VOLUME);
      }

    }, 0);
    return () => {
      clearTimeout(timer);
      settingsRequestRef.current?.abort();
    };
  }, []);

  const setWebSearch = useCallback((nextValue) => {
    _setWebSearch((prev) => {
      const resolved = typeof nextValue === "function" ? nextValue(prev) : nextValue;
      const normalized = normalizeWebSearchSettings(resolved, {
        defaultEnabled: prev?.enabled === true,
      });
      writeLocalJson(UI_WEB_SEARCH_KEY, normalized);
      return normalized;
    });
  }, []);

  const resetSettings = useCallback(() => {
    settingsRequestRef.current?.abort();
    settingsRequestRef.current = null;
    setIsSettingsReady(false);
    setSettingsError(null);
    setAssistant(DEFAULT_ASSISTANT);
    _setAvatar(null);
    _setNickname("");
    _setChatSystemPrompt("");
  }, []);

  const fetchSettings = useCallback(async () => {
    settingsRequestRef.current?.abort();
    const controller = new AbortController();
    settingsRequestRef.current = controller;
    setIsSettingsReady(false);
    setSettingsError(null);
    try {
      const data = await apiJson("/api/settings", { signal: controller.signal });
      if (controller.signal.aborted) return null;
      const settings = data?.settings;
      if (!settings || typeof settings !== "object") {
        setSettingsError("Invalid settings response");
        return null;
      }

      setSettingsError(null);
      if (settings.avatar !== undefined) {
        _setAvatar(settings.avatar);
      }
      if (settings.nickname !== undefined) {
        _setNickname(typeof settings.nickname === "string" ? settings.nickname : "");
      }
      if (settings.chatSystemPrompt !== undefined) {
        _setChatSystemPrompt(typeof settings.chatSystemPrompt === "string" ? settings.chatSystemPrompt : "");
      }
      setAssistant(settings.assistant);
      _setThemeMode(settings.appearance.themeMode);
      _setFontSize(settings.appearance.fontSize);
      _setCompletionSoundVolume(settings.appearance.completionSoundVolume);
      setThemePreference(settings.appearance.themeMode);
      writeLocalSetting(UI_FONT_SIZE_KEY,settings.appearance.fontSize);
      writeLocalSetting(UI_COMPLETION_SOUND_VOLUME_KEY,String(settings.appearance.completionSoundVolume));
      setIsSettingsReady(true);

      return settings;
    } catch (e) {
      if (!controller.signal.aborted) setSettingsError(e?.message);
      return null;
    } finally {
      if (settingsRequestRef.current === controller) settingsRequestRef.current = null;
    }
  }, []);


  return {
    assistant,
    isSettingsReady,
    themeMode,
    fontSize,
    webSearch,
    setWebSearch,
    completionSoundVolume,
    settingsError,
    fetchSettings,
    resetSettings,
    avatar,
    nickname,
    chatSystemPrompt,
  };
}
