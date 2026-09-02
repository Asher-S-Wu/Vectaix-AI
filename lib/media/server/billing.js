import { billingResult } from "@/lib/server/credits/api";
import { createPricingSnapshot } from "@/lib/server/credits/pricing";
import {
  getCreditSummary,
  markReviewRequired,
  releaseCredits,
  reserveCredits,
  settleCredits,
} from "@/lib/server/credits/service";
import CreditTransaction from "@/models/CreditTransaction";
import VideoEnhancementTask from "@/models/VideoEnhancementTask";
import VideoGenerationTask from "@/models/VideoGenerationTask";

const TASK_BILLING_RECOVERY_STATUSES = ["reserved", "settling", "review_required"];
const CREDIT_TERMINAL_STATUSES = ["settled", "released", "rejected"];

function storedBillingResult(transaction) {
  const { credit: _credit, ...billing } = billingResult(transaction, null);
  return billing;
}

export async function syncMediaTaskBillingByOperation(operationId, transaction = null) {
  const resolved = transaction || await CreditTransaction.findOne({ operationId }).lean();
  if (!resolved || !CREDIT_TERMINAL_STATUSES.includes(resolved.status)) {
    return { synced: false, happyHorse: 0, mediaKit: 0 };
  }
  const billing = storedBillingResult(resolved);
  const [happyHorse, mediaKit] = await Promise.all([
    VideoGenerationTask.updateMany(
      {
        "billing.operationId": operationId,
        "billing.status": { $in: TASK_BILLING_RECOVERY_STATUSES },
      },
      { $set: { billing } },
    ),
    VideoEnhancementTask.updateMany(
      {
        "billing.operationId": operationId,
        "billing.status": { $in: TASK_BILLING_RECOVERY_STATUSES },
      },
      { $set: { billing } },
    ),
  ]);
  return {
    synced: true,
    happyHorse: happyHorse.modifiedCount,
    mediaKit: mediaKit.modifiedCount,
  };
}

export async function reconcileResolvedMediaTaskBilling({ limit = 100 } = {}) {
  const pageSize = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 500) : 100;
  const [happyHorseTasks, mediaKitTasks] = await Promise.all([
    VideoGenerationTask.find({
      "billing.status": { $in: TASK_BILLING_RECOVERY_STATUSES },
      "billing.operationId": { $type: "string", $ne: "" },
    }).select("billing.operationId").limit(pageSize).lean(),
    VideoEnhancementTask.find({
      "billing.status": { $in: TASK_BILLING_RECOVERY_STATUSES },
      "billing.operationId": { $type: "string", $ne: "" },
    }).select("billing.operationId").limit(pageSize).lean(),
  ]);
  const operationIds = Array.from(new Set(
    [...happyHorseTasks, ...mediaKitTasks]
      .map((task) => task?.billing?.operationId)
      .filter((value) => typeof value === "string" && value),
  )).slice(0, pageSize);
  let syncedOperations = 0;
  for (const operationId of operationIds) {
    const result = await syncMediaTaskBillingByOperation(operationId);
    if (result.synced && (result.happyHorse > 0 || result.mediaKit > 0)) {
      syncedOperations += 1;
    }
  }
  return { scannedOperations: operationIds.length, syncedOperations };
}

export async function reserveMediaCredits({
  operationId,
  userId,
  feature,
  provider,
  model,
  estimate,
  settings,
  usage,
  executionClaimId,
  requestFingerprint,
}) {
  if (!settings || typeof settings !== "object") {
    throw new TypeError("媒体积分预留必须提供本次估价使用的计费设置");
  }
  const pricingSnapshot = createPricingSnapshot(settings);
  const transaction = await reserveCredits({
    operationId,
    userId,
    points: estimate.points,
    type: "model_usage",
    feature,
    provider,
    model,
    usage: { ...(usage || {}), requestFingerprint },
    pricingSnapshot,
    executionClaimId,
  });
  const credit = await getCreditSummary(userId);
  return { settings, pricingSnapshot, transaction, credit };
}

export async function settleMediaCredits({ reservation, operationId, userId, actual, usage, upstreamRequestIds = [] }) {
  const transaction = await settleCredits({
    operationId,
    chargedPoints: actual.points,
    actualCostCny: actual.costCny ?? undefined,
    actualCostUsd: actual.costUsd ?? undefined,
    usage,
    pricingSnapshot: reservation.pricingSnapshot,
    upstreamRequestIds,
    allowAdditionalDebit: true,
  });
  const credit = await getCreditSummary(userId);
  return { transaction, credit, billing: billingResult(transaction, credit) };
}

export async function releaseMediaCredits({ reservation, operationId, userId, usage, upstreamRequestIds = [] }) {
  const transaction = await releaseCredits(operationId, {
    usage,
    pricingSnapshot: reservation.pricingSnapshot,
    upstreamRequestIds,
  });
  const credit = await getCreditSummary(userId);
  return { transaction, credit, billing: billingResult(transaction, credit) };
}

export async function reviewMediaCredits({
  reservation,
  operationId,
  userId,
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
  const credit = await getCreditSummary(userId);
  return { transaction, credit, billing: billingResult(transaction, credit) };
}

export async function recoverMediaCreditFinalization({
  operationId,
  userId,
  reason,
  usage,
} = {}) {
  let transaction = await CreditTransaction.findOne({ operationId });
  if (!transaction) throw new Error("积分流水不存在，无法恢复媒体任务计费状态");
  if (transaction.status === "reserved") {
    transaction = await markReviewRequired(operationId, {
      reason: reason || "媒体任务终态计费失败",
      usage,
    });
  }
  const credit = await getCreditSummary(userId).catch(() => null);
  return { transaction, credit, billing: billingResult(transaction, credit) };
}
