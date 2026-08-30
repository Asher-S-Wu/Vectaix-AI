import { guestStorageKey } from "@/lib/client/guestAccess";

const SHARED_KEYS = new Set(["vectaix_ui_themeMode", "vectaix_ui_fontSize", "vectaix_ui_completionSoundVolume"]);
const storageKey = (key) => SHARED_KEYS.has(key) ? key : guestStorageKey(key);

function canUseStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

export function readLocalSetting(key) {
  try {
    if (!canUseStorage()) return null;
    const value = window.localStorage.getItem(storageKey(key));
    return typeof value === "string" && value ? value : null;
  } catch {
    return null;
  }
}

export function readLocalJson(key) {
  try {
    const value = readLocalSetting(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export function writeLocalSetting(key, value) {
  try {
    if (!canUseStorage()) return;
    if (value == null) {
      window.localStorage.removeItem(storageKey(key));
      return;
    }
    window.localStorage.setItem(storageKey(key), String(value));
  } catch {
    // ignore
  }
}

export function writeLocalJson(key, value) {
  try {
    if (!canUseStorage()) return;
    if (value == null) {
      window.localStorage.removeItem(storageKey(key));
      return;
    }
    window.localStorage.setItem(storageKey(key), JSON.stringify(value));
  } catch {
    // ignore
  }
}
