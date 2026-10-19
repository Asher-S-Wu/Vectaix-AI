import MinimaxVoice from "@/models/MinimaxVoice";
import CreditTransaction from "@/models/CreditTransaction";
import { markReviewRequired, releaseCredits } from "@/lib/server/credits/service";
import { listMinimaxClonedVoiceIds } from "@/lib/media/server/minimaxAudio";

const STALE_CLAIM_MS = 15 * 60 * 1000;
const RECONCILE_BATCH_SIZE = 100;

function claimConflictError(needsReview) {
  return Object.assign(new Error(needsReview
    ? "上次音色解锁结果待确认，系统会在请求满 15 分钟后查询实际状态，请稍后重试"
    : "该自定义音色正在完成首次解锁，请稍后再试"), {
    status: 409,
    code: needsReview ? "MINIMAX_UNLOCK_REVIEW_REQUIRED" : "MINIMAX_UNLOCK_IN_PROGRESS",
  });
}

export async function claimMinimaxVoiceUnlock({ userId, profileId, operationId, signal }) {
  const existing = await MinimaxVoice.findOne({ userId, profileId, status: "READY" })
    .select("unlockedAt claimOperationId claimStartedAt")
    .lean();
  if (!existing) {
    throw Object.assign(new Error("MiniMax 复刻音色不存在"), { status: 404 });
  }
  if (existing.unlockedAt) return { firstVoiceClone: false, claimed: false };
  if (existing.claimOperationId && (!existing.claimStartedAt || existing.claimStartedAt.getTime() <= Date.now() - STALE_CLAIM_MS)) {
    await reconcileMinimaxUnlockClaims(new Date(), { userId, profileId, signal });
  }

  const claimed = await MinimaxVoice.findOneAndUpdate(
    {
      userId,
      profileId,
      status: "READY",
      unlockedAt: null,
      $or: [
        { claimOperationId: null },
        { claimOperationId: { $exists: false } },
      ],
    },
    {
      $set: {
        claimOperationId: operationId,
        claimStartedAt: new Date(),
      },
    },
    { new: true, runValidators: true },
  ).select("claimOperationId").lean();
  if (claimed) return { firstVoiceClone: true, claimed: true };

  const current = await MinimaxVoice.findOne({ userId, profileId, status: "READY" })
    .select("unlockedAt claimOperationId")
    .lean();
  if (current?.unlockedAt) return { firstVoiceClone: false, claimed: false };
  const transaction = current?.claimOperationId
    ? await CreditTransaction.findOne({ operationId: current.claimOperationId, userId }).select("status").lean()
    : null;
  throw claimConflictError(transaction?.status === "review_required");
}

export async function releaseMinimaxVoiceUnlockClaim({ userId, profileId, operationId }) {
  const result = await MinimaxVoice.updateOne(
    { userId, profileId, claimOperationId: operationId, unlockedAt: null },
    { $unset: { claimOperationId: 1, claimStartedAt: 1 } },
    { runValidators: true },
  );
  return result.modifiedCount === 1;
}

export async function completeMinimaxVoiceUnlockClaim({ userId, profileId, operationId }) {
  const result = await MinimaxVoice.updateOne(
    { userId, profileId, claimOperationId: operationId, unlockedAt: null },
    {
      $set: { unlockedAt: new Date() },
      $unset: { claimOperationId: 1, claimStartedAt: 1 },
    },
    { runValidators: true },
  );
  return result.modifiedCount === 1;
}

export async function reconcileMinimaxUnlockClaims(now = new Date(), { userId, profileId, signal } = {}) {
  const cutoff = new Date(now.getTime() - STALE_CLAIM_MS);
  const voices = await MinimaxVoice.find({
    claimOperationId: { $type: "string", $ne: "" },
    unlockedAt: null,
    ...(userId ? { userId } : {}),
    ...(profileId ? { profileId } : {}),
    $or: [
      { claimStartedAt: { $lte: cutoff } },
      { claimStartedAt: null },
      { claimStartedAt: { $exists: false } },
    ],
  })
    .select("_id userId profileId voiceId claimOperationId claimStartedAt")
    .sort({ claimStartedAt: 1, _id: 1 })
    .limit(RECONCILE_BATCH_SIZE)
    .lean();

  const result = { scanned: voices.length, cleared: 0, unlocked: 0, reviewed: 0, retained: 0 };
  let remoteVoices;
  for (const voice of voices) {
    const transaction = await CreditTransaction.findOne({ operationId: voice.claimOperationId })
      .select("status userId usage actorUserId reason")
      .lean();
    const successfulZeroCostRelease = transaction?.status === "released"
      && !transaction.actorUserId
      && !transaction.reason
      && transaction.usage?.failedBeforeCompletion !== true
      && transaction.usage?.unlockConfirmedUnused !== true
      && transaction.usage?.firstVoiceClone === true
      && ["hd", "turbo"].includes(transaction.usage?.quality)
      && Number.isSafeInteger(transaction.usage?.characters)
      && transaction.usage.characters > 0;
    if (
      !transaction
      || ["pending", "rejected"].includes(transaction.status)
      || (transaction.status === "released" && !successfulZeroCostRelease)
      || String(transaction.userId || "") !== String(voice.userId)
    ) {
      const cleared = await releaseMinimaxVoiceUnlockClaim({
        userId: voice.userId,
        profileId: voice.profileId,
        operationId: voice.claimOperationId,
      });
      if (cleared) result.cleared += 1;
      continue;
    }
    if (transaction.status === "settled" || successfulZeroCostRelease || transaction.usage?.upstreamCompleted === true) {
      const unlocked = await completeMinimaxVoiceUnlockClaim({
        userId: voice.userId,
        profileId: voice.profileId,
        operationId: voice.claimOperationId,
      });
      if (unlocked) result.unlocked += 1;
      continue;
    }
    if (["reserved", "review_required"].includes(transaction.status)) {
      // 百炼仅返回成功用于合成的复刻音色：https://help.aliyun.com/zh/model-studio/sound-management
      remoteVoices ||= await listMinimaxClonedVoiceIds({ signal });
      if (remoteVoices.voiceIds.has(voice.voiceId)) {
        await markReviewRequired(voice.claimOperationId, {
          reason: "已确认 MiniMax 音色完成首次解锁，原请求的实际用量待核对",
          usage: { ...transaction.usage, unlockConfirmed: true, profileId: voice.profileId },
          upstreamRequestIds: [remoteVoices.requestId].filter(Boolean),
        });
        if (transaction.status === "reserved") result.reviewed += 1;
        const unlocked = await completeMinimaxVoiceUnlockClaim({
          userId: voice.userId, profileId: voice.profileId, operationId: voice.claimOperationId,
        });
        if (unlocked) result.unlocked += 1;
      } else {
        await releaseCredits(voice.claimOperationId, {
          reason: "已查询 MiniMax，音色尚未完成首次合成",
          usage: { ...transaction.usage, unlockConfirmedUnused: true },
        });
        const cleared = await releaseMinimaxVoiceUnlockClaim({
          userId: voice.userId, profileId: voice.profileId, operationId: voice.claimOperationId,
        });
        if (cleared) result.cleared += 1;
      }
      continue;
    }
    result.retained += 1;
  }
  return result;
}
