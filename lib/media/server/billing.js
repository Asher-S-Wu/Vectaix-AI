import { billingResult } from "@/lib/server/credits/api";
import { createPricingSnapshot } from "@/lib/server/credits/pricing";
import {
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
  return billingResult(transaction);
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

export async function recoverMediaCreditFinalization({
  operationId,
  reason,
  usage,
} = {}) {
  let transaction = await CreditTransaction.findOne({ operationId });
  if (!transaction) throw new Error("费用记录不存在，无法恢复媒体任务计费状态");
  if (transaction.status === "reserved") {
    transaction = await markReviewRequired(operationId, {
      reason: reason || "媒体任务终态计费失败",
      usage,
    });
  }
  return { transaction, billing: billingResult(transaction) };
}
