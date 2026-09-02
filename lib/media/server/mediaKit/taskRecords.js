import { normalizeVideoEnhancementError } from "@/lib/media/shared/videoEnhancement";
import { buildStoredFileUrl } from "@/lib/server/storage/service";
import { calculateMediaKitCost } from "@/lib/server/credits/pricing";
import {
  releaseMediaCredits,
  recoverMediaCreditFinalization,
  reviewMediaCredits,
  settleMediaCredits,
} from "@/lib/media/server/billing";
import VideoEnhancementTask from "@/models/VideoEnhancementTask";

function normalizeObject(value) {
  if (!value || typeof value !== "object") return null;
  return typeof value.toObject === "function" ? value.toObject() : value;
}

function serializeTaskBilling(value) {
  if (!value || typeof value !== "object") return null;
  return value;
}

function billingIsFinal(value) {
  return ["settled", "released", "review_required", "rejected"].includes(value?.status);
}

export async function finalizeMediaKitTaskBilling(task, {
  status,
  durationSeconds = null,
  unknown = false,
  usage = null,
} = {}) {
  const item = normalizeObject(task);
  const billing = item?.billing;
  const pricingSnapshot = item?.billingPricingSnapshot;
  if (!billing?.operationId || !pricingSnapshot || billingIsFinal(billing)) return item;
  const reservation = { pricingSnapshot };
  const duration = Number(durationSeconds);
  let result;
  try {
    if (status === "completed" && Number.isFinite(duration) && duration > 0) {
      result = await settleMediaCredits({
        reservation,
        operationId: billing.operationId,
        userId: String(item.userId),
        actual: calculateMediaKitCost({ durationSeconds: duration }, pricingSnapshot),
        usage: { ...(usage || {}), durationSeconds: duration },
        upstreamRequestIds: [item.upstreamTaskId].filter(Boolean),
      });
    } else if (["failed", "canceled"].includes(status) && !unknown) {
      result = await releaseMediaCredits({
        reservation,
        operationId: billing.operationId,
        userId: String(item.userId),
        usage: usage || { terminalStatus: status },
        upstreamRequestIds: [item.upstreamTaskId].filter(Boolean),
      });
    } else {
      result = await reviewMediaCredits({
        reservation,
        operationId: billing.operationId,
        userId: String(item.userId),
        reason: status === "completed"
          ? "MediaKit 任务已完成但没有可核对的 result.duration"
          : "MediaKit 任务结果不明确",
        usage: usage || { terminalStatus: status },
      });
    }
  } catch (error) {
    result = await recoverMediaCreditFinalization({
      operationId: billing.operationId,
      userId: String(item.userId),
      reason: error?.code === "CREDIT_CHARGE_EXCEEDS_RESERVATION"
        ? "MediaKit 实际积分超过预留积分"
        : "MediaKit 终态计费失败",
      usage: usage || { terminalStatus: status },
    });
  }
  const { credit: _credit, ...storedBilling } = result.billing;
  const updated = await VideoEnhancementTask.findOneAndUpdate(
    {
      _id: item._id,
      "billing.operationId": billing.operationId,
      "billing.status": billing.status,
    },
    { $set: { billing: storedBilling } },
    { new: true },
  ).select("+upstreamTaskId +billingPricingSnapshot").lean();
  return updated || VideoEnhancementTask.findById(item._id)
    .select("+upstreamTaskId +billingPricingSnapshot")
    .lean();
}

function serializeTaskError(item) {
  if (!["failed", "canceled"].includes(item.status)) return null;
  const code = item.error?.code || (item.status === "canceled" ? "TASK_CANCELED" : "TASK_FAILED");
  return normalizeVideoEnhancementError({ code });
}

function serializeTaskResult(item) {
  if (item.status !== "completed" || !item.videoFileId || !item.result) return null;
  const videoUrl = buildStoredFileUrl(String(item.videoFileId));
  if (!videoUrl) return null;
  return {
    videoUrl,
    downloadUrl: `${videoUrl}?download=1`,
    size: item.result.size,
    duration: item.result.duration,
    resolution: item.result.resolution,
    fps: item.result.fps,
  };
}

export function serializeMediaKitUploadTicket(ticket) {
  const item = normalizeObject(ticket);
  if (!item) return null;
  return {
    id: String(item._id || item.id || ""),
    status: item.status,
    name: item.safeOriginalName,
    size: item.size,
    mimeType: item.mimeType,
    expiresAt: item.expiresAt || null,
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
  };
}

export function serializeVideoEnhancementTask(task) {
  const item = normalizeObject(task);
  if (!item) return null;
  const source = {
    type: item.sourceType,
    name: item.sourceName,
  };
  if (item.sourceType === "url") source.host = item.sourceHost;
  return {
    id: String(item._id || item.id || ""),
    model: item.model,
    status: item.status,
    source,
    sourceDuration: {
      seconds: Number(item.sourceDurationSeconds) || 0,
      verified: item.sourceDurationVerified === true,
    },
    settings: {
      resolution: item.settings?.resolution,
      fps: item.settings?.fps ?? null,
      bitrate: {
        mode: item.settings?.bitrate?.mode,
        value: item.settings?.bitrate?.value,
      },
    },
    error: serializeTaskError(item),
    result: serializeTaskResult(item),
    billing: serializeTaskBilling(item.billing),
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
    lastSyncedAt: item.lastSyncedAt || null,
  };
}
