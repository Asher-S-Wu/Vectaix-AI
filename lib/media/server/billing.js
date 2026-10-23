import { billingResult } from "@/lib/server/credits/api";
import { createPricingSnapshot } from "@/lib/server/credits/pricing";
import {
  markReviewRequired,
  releaseCredits,
  reserveCredits,
  settleCredits,
} from "@/lib/server/credits/service";

export async function reserveMediaCredits({
  operationId,
  userId,
  feature,
  provider,
  model,
  settings,
  usage,
  executionClaimId,
  requestFingerprint,
}) {
  if (!settings || typeof settings !== "object") {
    throw new TypeError("媒体费用记录必须提供本次估价使用的计费设置");
  }
  const pricingSnapshot = createPricingSnapshot(settings);
  const transaction = await reserveCredits({
    operationId,
    userId,
    type: "model_usage",
    feature,
    provider,
    model,
    usage: { ...(usage || {}), requestFingerprint },
    pricingSnapshot,
    executionClaimId,
  });
  return { settings, pricingSnapshot, transaction };
}

export async function settleMediaCredits({ reservation, operationId, actual, usage, upstreamRequestIds = [] }) {
  const transaction = await settleCredits({
    operationId,
    actualCostCny: actual.costCny ?? undefined,
    actualCostUsd: actual.costUsd ?? undefined,
    usage,
    pricingSnapshot: reservation.pricingSnapshot,
    upstreamRequestIds,
  });
  return { transaction, billing: billingResult(transaction) };
}

export async function releaseMediaCredits({ reservation, operationId, usage, upstreamRequestIds = [] }) {
  const transaction = await releaseCredits(operationId, {
    usage,
    pricingSnapshot: reservation.pricingSnapshot,
    upstreamRequestIds,
  });
  return { transaction, billing: billingResult(transaction) };
}

export async function reviewMediaCredits({
  operationId,
  reason,
  actual,
  usage,
  upstreamRequestIds = [],
}) {
  const transaction = await markReviewRequired(operationId, {
    reason,
    usage,
    upstreamRequestIds,
    ...(actual?.costCny === undefined ? {} : { actualCostCny: actual.costCny }),
    ...(actual?.costUsd === undefined ? {} : { actualCostUsd: actual.costUsd }),
  });
  return { transaction, billing: billingResult(transaction) };
}
