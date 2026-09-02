import CreditTransaction from "@/models/CreditTransaction";
import User from "@/models/User";
import { CreditError } from "./errors";
import {
  adjustBalance,
  releaseCredits,
  settleCredits,
} from "./service";

async function normalizePendingHold(transaction, hold, balance) {
  if (transaction.status !== "pending") return transaction;
  return CreditTransaction.findOneAndUpdate(
    { _id: transaction._id, status: "pending" },
    {
      $set: {
        status: "reserved",
        balanceBefore: balance + hold.points,
        balanceAfter: balance,
      },
    },
    { new: true, runValidators: true },
  );
}

export async function closeUserCreditsForDeletion(userId) {
  let user = await User.findById(userId)
    .select("creditBalance creditHeld creditHolds creditSettlementReceipts")
    .lean();
  if (!user) return { releasedHolds: 0 };

  for (const receipt of user.creditSettlementReceipts || []) {
    const transaction = await CreditTransaction.findOne({ operationId: receipt.operationId });
    if (!transaction) {
      throw new CreditError("用户存在没有对应流水的钱包结算回执，不能安全删除账号", {
        code: "CREDIT_ORPHAN_SETTLEMENT_RECEIPT",
        statusCode: 409,
      });
    }
    if (["settling", "review_required"].includes(transaction.status)) {
      if (receipt.kind === "admin_set" && transaction.type === "admin_set") {
        await adjustBalance({
          operationId: transaction.operationId,
          userId,
          targetBalance: transaction.usage?.targetAvailableBalance,
          actorUserId: transaction.actorUserId,
          reason: transaction.reason,
        });
      } else if (receipt.kind === "model_settlement" && transaction.type === "model_usage") {
        await settleCredits({
          operationId: transaction.operationId,
          chargedPoints: transaction.charged,
          ...(transaction.actualCostCny === null ? {} : { actualCostCny: transaction.actualCostCny }),
          ...(transaction.actualCostUsd === null ? {} : { actualCostUsd: transaction.actualCostUsd }),
          usage: transaction.usage,
          pricingSnapshot: transaction.pricingSnapshot,
          upstreamRequestIds: transaction.upstreamRequestIds,
          allowAdditionalDebit: transaction.charged > transaction.reserved,
        });
      } else {
        throw new CreditError("钱包结算回执类型与流水不一致，不能安全删除账号", {
          code: "CREDIT_SETTLEMENT_RECEIPT_CONFLICT",
          statusCode: 409,
        });
      }
    } else if (["settled", "released", "rejected"].includes(transaction.status)) {
      await User.updateOne(
        { _id: userId },
        { $pull: { creditSettlementReceipts: { operationId: receipt.operationId } } },
        { runValidators: true },
      );
    } else {
      throw new CreditError("钱包结算回执与流水状态不一致，不能安全删除账号", {
        code: "CREDIT_SETTLEMENT_RECEIPT_CONFLICT",
        statusCode: 409,
      });
    }
  }
  user = await User.findById(userId)
    .select("creditBalance creditHeld creditHolds creditSettlementReceipts")
    .lean();
  if (!user) return { releasedHolds: 0 };

  let releasedHolds = 0;
  for (const hold of user.creditHolds || []) {
    let transaction = await CreditTransaction.findOne({ operationId: hold.operationId });
    if (!transaction) {
      throw new CreditError("用户存在没有对应流水的冻结积分，不能安全删除账号", {
        code: "CREDIT_ORPHAN_HOLD",
        statusCode: 409,
      });
    }
    transaction = await normalizePendingHold(transaction, hold, user.creditBalance);
    if (
      transaction.status === "reserved"
      && typeof transaction.executionClaimId === "string"
      && transaction.executionClaimId
    ) {
      throw new CreditError("该用户仍有正在执行的模型请求，请等待请求完成后再删除", {
        code: "CREDIT_ACTIVE_OPERATION",
        statusCode: 409,
      });
    }
    if (transaction.status === "settling") {
      await settleCredits({
        operationId: transaction.operationId,
        chargedPoints: transaction.charged,
        ...(transaction.actualCostCny === null ? {} : { actualCostCny: transaction.actualCostCny }),
        ...(transaction.actualCostUsd === null ? {} : { actualCostUsd: transaction.actualCostUsd }),
        usage: transaction.usage,
        pricingSnapshot: transaction.pricingSnapshot,
        upstreamRequestIds: transaction.upstreamRequestIds,
      });
    } else if (["reserved", "review_required"].includes(transaction.status)) {
      await releaseCredits(transaction.operationId, {
        usage: transaction.usage,
        pricingSnapshot: transaction.pricingSnapshot,
        upstreamRequestIds: transaction.upstreamRequestIds,
      });
    }
    releasedHolds += 1;
    user = await User.findById(userId)
      .select("creditBalance creditHeld creditHolds creditSettlementReceipts")
      .lean();
    if (!user) break;
  }

  const danglingTransactions = await CreditTransaction.find({
    userId,
    status: { $in: ["pending", "settling"] },
  });
  for (const transaction of danglingTransactions) {
    const state = await User.findById(userId)
      .select("creditHolds creditSettlementReceipts")
      .lean();
    const hasHold = state?.creditHolds?.some(
      (hold) => hold.operationId === transaction.operationId,
    );
    const hasReceipt = state?.creditSettlementReceipts?.some(
      (receipt) => receipt.operationId === transaction.operationId,
    );
    if (hasHold || hasReceipt) {
      throw new CreditError("仍有积分操作正在完成结算，请稍后重试删除", {
        code: "CREDIT_SETTLEMENT_IN_PROGRESS",
        statusCode: 409,
      });
    }
    if (transaction.status === "pending" || transaction.type !== "model_usage") {
      await CreditTransaction.updateOne(
        { _id: transaction._id, status: transaction.status },
        { $set: { status: "rejected", reason: "账号删除前该操作尚未应用" } },
        { runValidators: true },
      );
      continue;
    }
    throw new CreditError("模型消费流水缺少可确认的钱包状态，不能安全删除账号", {
      code: "CREDIT_SETTLEMENT_STATE_UNKNOWN",
      statusCode: 409,
    });
  }

  const remaining = await User.findById(userId)
    .select("creditHeld creditHolds creditSettlementReceipts")
    .lean();
  if (remaining && (
    (Number(remaining.creditHeld) || 0) !== 0
    || remaining.creditHolds?.length
    || remaining.creditSettlementReceipts?.length
  )) {
    throw new CreditError("用户仍有未处理的冻结积分或结算回执，不能安全删除账号", {
      code: "CREDIT_HOLDS_REMAIN",
      statusCode: 409,
    });
  }
  return { releasedHolds };
}
