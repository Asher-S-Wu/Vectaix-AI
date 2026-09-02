import MinimaxVoice from "@/models/MinimaxVoice";
import CreditTransaction from "@/models/CreditTransaction";
import { markReviewRequired } from "@/lib/server/credits/service";

const STALE_CLAIM_MS = 15 * 60 * 1000;
const RECONCILE_BATCH_SIZE = 100;

function claimConflictError() {
  return Object.assign(new Error("该自定义音色正在完成首次解锁，请稍后再试"), {
    status: 409,
    code: "MINIMAX_UNLOCK_IN_PROGRESS",
  });
}

export async function claimMinimaxVoiceUnlock({ userId, profileId, operationId }) {
  const existing = await MinimaxVoice.findOne({ userId, profileId, status: "READY" })
    .select("unlockedAt claimOperationId")
    .lean();
  if (!existing) {
    throw Object.assign(new Error("MiniMax 复刻音色不存在"), { status: 404 });
  }
  if (existing.unlockedAt) return { firstVoiceClone: false, claimed: false };

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
  throw claimConflictError();
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

export async function resolveMinimaxUnlockClaimByOperation({ operationId, action }) {
  if (action === "settle") {
    const result = await MinimaxVoice.updateOne(
      { claimOperationId: operationId, unlockedAt: null },
      {
        $set: { unlockedAt: new Date() },
        $unset: { claimOperationId: 1, claimStartedAt: 1 },
      },
      { runValidators: true },
    );
    return result.modifiedCount === 1;
  }
  if (action === "release") {
    const result = await MinimaxVoice.updateOne(
      { claimOperationId: operationId, unlockedAt: null },
      { $unset: { claimOperationId: 1, claimStartedAt: 1 } },
      { runValidators: true },
    );
    return result.modifiedCount === 1;
  }
  throw new TypeError("不支持的 MiniMax 解锁处理动作");
}

export async function reconcileMinimaxUnlockClaims(now = new Date()) {
  const cutoff = new Date(now.getTime() - STALE_CLAIM_MS);
  const voices = await MinimaxVoice.find({
    claimOperationId: { $type: "string", $ne: "" },
    unlockedAt: null,
    $or: [
      { claimStartedAt: { $lte: cutoff } },
      { claimStartedAt: null },
      { claimStartedAt: { $exists: false } },
    ],
  })
    .select("_id userId profileId claimOperationId claimStartedAt")
    .sort({ claimStartedAt: 1, _id: 1 })
    .limit(RECONCILE_BATCH_SIZE)
    .lean();

  const result = { scanned: voices.length, cleared: 0, unlocked: 0, reviewed: 0, retained: 0 };
  for (const voice of voices) {
    const transaction = await CreditTransaction.findOne({ operationId: voice.claimOperationId })
      .select("status userId usage actorUserId reason")
      .lean();
    const successfulZeroCostRelease = transaction?.status === "released"
      && !transaction.actorUserId
      && !transaction.reason
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
    if (transaction.status === "settled" || successfulZeroCostRelease) {
      const unlocked = await completeMinimaxVoiceUnlockClaim({
        userId: voice.userId,
        profileId: voice.profileId,
        operationId: voice.claimOperationId,
      });
      if (unlocked) result.unlocked += 1;
      continue;
    }
    if (transaction.status === "reserved") {
      await markReviewRequired(voice.claimOperationId, {
        reason: "MiniMax 自定义音色首次合成结果长期未确认",
        usage: {
          ...(transaction.usage || {}),
          unlockClaimStale: true,
          profileId: voice.profileId,
        },
      });
      result.reviewed += 1;
      continue;
    }
    result.retained += 1;
  }
  return result;
}
