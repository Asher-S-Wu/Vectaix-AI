export const CREDIT_SUMMARY_EVENT = "vectaix-credit-summary";

export function normalizeCreditSummary(value) {
  if (!value || typeof value !== "object") return null;
  const userId = typeof value.userId === "string" ? value.userId.trim() : "";
  const version = Number(value.version);
  if (!userId || !Number.isSafeInteger(version) || version < 0) return null;
  const unlimited = value.unlimited === true || value.isUnlimited === true;
  if (unlimited) return { userId, version, availablePoints: 0, heldPoints: 0, unlimited: true };
  const availablePoints = Number(value.availablePoints ?? value.availableCredits);
  const heldPoints = Number(value.heldPoints ?? value.heldCredits);
  if (
    !Number.isInteger(availablePoints)
    || availablePoints < 0
    || !Number.isInteger(heldPoints)
    || heldPoints < 0
  ) {
    return null;
  }
  return { userId, version, availablePoints, heldPoints, unlimited: false };
}

export function notifyCreditSummary(summary) {
  const normalized = normalizeCreditSummary(summary);
  if (typeof window === "undefined" || !normalized) return null;
  window.dispatchEvent(new CustomEvent(CREDIT_SUMMARY_EVENT, { detail: normalized }));
  return normalized;
}

export function notifyCreditFromPayload(payload) {
  const summary = payload?.billing?.credit || payload?.credit || payload?.creditSummary;
  return notifyCreditSummary(summary);
}

export function notifyCreditFromResponseHeaders(response) {
  const available = response?.headers?.get?.("x-credit-available");
  const held = response?.headers?.get?.("x-credit-held");
  const unlimited = response?.headers?.get?.("x-credit-unlimited");
  const userId = response?.headers?.get?.("x-credit-user");
  const version = response?.headers?.get?.("x-credit-version");
  if (available === null && held === null && unlimited === null && userId === null && version === null) return null;
  return notifyCreditSummary({
    userId,
    version: Number(version),
    availablePoints: Number(available || 0),
    heldPoints: Number(held || 0),
    unlimited: unlimited === "true",
  });
}
