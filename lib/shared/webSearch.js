export const DEFAULT_WEB_SEARCH_SETTINGS = Object.freeze({
  enabled: true,
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeWebSearchSettings(value, { defaultEnabled = DEFAULT_WEB_SEARCH_SETTINGS.enabled } = {}) {
  const base = {
    ...DEFAULT_WEB_SEARCH_SETTINGS,
    enabled: defaultEnabled,
  };

  if (!isPlainObject(value)) {
    return base;
  }

  return {
    enabled: normalizeBoolean(value.enabled, base.enabled),
  };
}
