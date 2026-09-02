
function canUseStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

export function readLocalSetting(key) {
  try {
    if (!canUseStorage()) return null;
    const value = window.localStorage.getItem(key);
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
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, String(value));
  } catch {
    // ignore
  }
}

export function writeLocalJson(key, value) {
  try {
    if (!canUseStorage()) return;
    if (value == null) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}
