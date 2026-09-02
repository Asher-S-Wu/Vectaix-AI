import crypto from "node:crypto";
import mongoose from "mongoose";

import { isAdminEmail } from "@/lib/admin";
import dbConnect from "@/lib/db";
import CreditTransaction from "@/models/CreditTransaction";
import User from "@/models/User";
import { CreditError, InsufficientCreditsError, invalidCreditArgument } from "./errors";

const TERMINAL_STATUSES = new Set(["settled", "released", "rejected"]);
const PENDING_RECOVERY_STALE_MS = 5 * 60 * 1000;
const SETTLING_RECOVERY_STALE_MS = 2 * 60 * 1000;
const CLAIMED_EXECUTION_STALE_MS = 30 * 60 * 1000;

function assertObjectId(value, name) {
  if (!mongoose.isValidObjectId(value)) {
    throw invalidCreditArgument(`${name} 不是有效用户 ID`);
  }
}

function assertPoints(value, name) {
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(value)) {
    throw invalidCreditArgument(`${name} 必须是非负整数`);
  }
}

function assertOptionalAmount(value, name) {
  if (value !== undefined && value !== null && (!Number.isFinite(value) || value < 0)) {
    throw invalidCreditArgument(`${name} 必须是非负有限数字`);
  }
}

function normalizeOperationId(value) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 200) {
    throw invalidCreditArgument("operationId 必须是 1 到 200 个字符的字符串");
  }
  return value.trim();
}

function normalizeClaimId(value) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 200) {
    throw invalidCreditArgument("claimId 必须是 1 到 200 个字符的字符串");
  }
  return value.trim();
}

function normalizeStringArray(value, name) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw invalidCreditArgument(`${name} 必须是非空字符串数组`);
  }
  return [...new Set(value.map((item) => item.trim()))];
}

function plain(document) {
  return document?.toObject ? document.toObject() : document;
}

function canonicalValue(value, path = "value") {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw invalidCreditArgument(`${path} 包含无效数字`);
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item, index) => canonicalValue(item, `${path}[${index}]`));
  if (value && typeof value === "object") {
    const source = value?.toObject ? value.toObject() : value;
    const result = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) throw invalidCreditArgument(`${path}.${key} 不能是 undefined`);
      result[key] = canonicalValue(source[key], `${path}.${key}`);
    }
    return result;
  }
  throw invalidCreditArgument(`${path} 包含不支持的值`);
}

function sameCanonical(left, right) {
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
}

function reservationRequestHash(input) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(canonicalValue({
      userId: String(input.userId),
      actorUserId: input.actorUserId ? String(input.actorUserId) : "",
      points: input.points,
      type: input.type,
      feature: input.feature,
      provider: input.provider,
      model: input.model,
      usage: input.usage,
      pricingSnapshot: input.pricingSnapshot,
      upstreamRequestIds: input.upstreamRequestIds,
      reason: input.reason,
    })))
    .digest("hex");
}

async function resolveAuditUserKey(userId) {
  const generated = crypto.randomUUID();
  const objectId = new mongoose.Types.ObjectId(String(userId));
  const initialized = await User.collection.findOneAndUpdate(
    {
      _id: objectId,
      $or: [
        { creditAuditKey: { $exists: false } },
        { creditAuditKey: null },
      ],
    },
    { $set: { creditAuditKey: generated } },
    {
      returnDocument: "after",
      includeResultMetadata: false,
      projection: { creditAuditKey: 1 },
    },
  );
  if (initialized?.creditAuditKey) return initialized.creditAuditKey;
  const existing = await User.collection.findOne(
    { _id: objectId },
    { projection: { creditAuditKey: 1 } },
  );
  if (typeof existing?.creditAuditKey !== "string" || !existing.creditAuditKey) {
    throw new CreditError("用户不存在或审计标识初始化失败", {
      code: "CREDIT_USER_NOT_FOUND",
      statusCode: 404,
    });
  }
  return existing.creditAuditKey;
}

export const getOrCreateCreditAuditKey = resolveAuditUserKey;

function operationConflict(message) {
  return new CreditError(message, {
    code: "CREDIT_OPERATION_CONFLICT",
    statusCode: 409,
  });
}

function assertReservationReplay(transaction, input) {
  const requestHash = reservationRequestHash(input);
  if (transaction.reservationRequestHash !== requestHash) {
    throw operationConflict("同一 operationId 的预留请求内容不一致");
  }
  const fields = ["type", "feature", "provider", "model"];
  if (String(transaction.userId) !== String(input.userId)) {
    throw operationConflict("同一 operationId 的用户不一致");
  }
  if (String(transaction.actorUserId || "") !== String(input.actorUserId || "")) {
    throw operationConflict("同一 operationId 的操作人不一致");
  }
  for (const field of fields) {
    if (transaction[field] !== input[field]) {
      throw operationConflict(`同一 operationId 的 ${field} 不一致`);
    }
  }
  const requestFingerprint = input.usage?.requestFingerprint;
  if (typeof requestFingerprint === "string" && requestFingerprint) {
    if (transaction.usage?.requestFingerprint !== requestFingerprint) {
      throw operationConflict("同一 operationId 的请求内容不一致");
    }
    return;
  }
  if (transaction.requested !== input.points) {
    throw operationConflict("同一 operationId 的预留积分不一致");
  }
}

export async function getCreditOperation({ operationId, userId, requestFingerprint } = {}) {
  await dbConnect();
  const normalizedOperationId = normalizeOperationId(operationId);
  assertObjectId(userId, "userId");
  const transaction = await CreditTransaction.findOne({ operationId: normalizedOperationId }).lean();
  if (!transaction) return null;
  if (String(transaction.userId) !== String(userId)) {
    throw operationConflict("operationId 已被其他用户使用");
  }
  if (
    typeof requestFingerprint !== "string"
    || !requestFingerprint
    || transaction.usage?.requestFingerprint !== requestFingerprint
  ) {
    throw operationConflict("同一 operationId 的请求内容不一致");
  }
  return transaction;
}

export async function claimCreditOperation(operationId, claimId) {
  await dbConnect();
  const normalizedOperationId = normalizeOperationId(operationId);
  const normalizedClaimId = normalizeClaimId(claimId);
  const claimedAt = new Date();
  let transaction;
  try {
    transaction = await CreditTransaction.findOneAndUpdate(
      {
        operationId: normalizedOperationId,
        status: "reserved",
        executionClaimId: { $exists: false },
      },
      { $set: { executionClaimId: normalizedClaimId, claimedAt } },
      { new: true, runValidators: true },
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
    throw operationConflict("claimId 已被其他积分操作使用");
  }
  if (transaction) {
    return { claimed: true, alreadyProcessed: false, transaction: plain(transaction) };
  }

  const existing = await CreditTransaction.findOne({ operationId: normalizedOperationId });
  if (!existing) {
    throw new CreditError("积分流水不存在", {
      code: "CREDIT_TRANSACTION_NOT_FOUND",
      statusCode: 404,
    });
  }
  if (TERMINAL_STATUSES.has(existing.status)) {
    return { claimed: false, alreadyProcessed: true, transaction: plain(existing) };
  }
  throw new CreditError("本次请求已在处理中，请勿重复提交", {
    code: "CREDIT_OPERATION_ALREADY_CLAIMED",
    statusCode: 409,
    details: { status: existing.status },
  });
}

export async function releaseCreditExecutionClaim(operationId, claimId) {
  await dbConnect();
  const normalizedOperationId = normalizeOperationId(operationId);
  const normalizedClaimId = normalizeClaimId(claimId);
  const transaction = await CreditTransaction.findOneAndUpdate(
    {
      operationId: normalizedOperationId,
      status: "reserved",
      executionClaimId: normalizedClaimId,
    },
    { $unset: { executionClaimId: 1, claimedAt: 1 } },
    { new: true, runValidators: true },
  );
  if (transaction) return plain(transaction);
  const existing = await CreditTransaction.findOne({ operationId: normalizedOperationId });
  if (!existing) {
    throw new CreditError("积分流水不存在", {
      code: "CREDIT_TRANSACTION_NOT_FOUND",
      statusCode: 404,
    });
  }
  throw operationConflict("积分执行 claim 已变化，不能移交给异步任务");
}

function assertSettlementReplay(transaction, {
  chargedPoints,
  actualCostCny,
  actualCostUsd,
  usage,
  pricingSnapshot,
  upstreamRequestIds,
  actorUserId,
  reason,
}) {
  if (transaction.charged !== chargedPoints) {
    throw operationConflict("同一 operationId 的结算积分不一致");
  }
  if (actualCostCny !== undefined && transaction.actualCostCny !== actualCostCny) {
    throw operationConflict("同一 operationId 的人民币成本不一致");
  }
  if (actualCostUsd !== undefined && transaction.actualCostUsd !== actualCostUsd) {
    throw operationConflict("同一 operationId 的美元成本不一致");
  }
  for (const [field, value] of Object.entries({ usage, pricingSnapshot, upstreamRequestIds })) {
    if (value !== undefined && !sameCanonical(transaction[field], value)) {
      throw operationConflict(`同一 operationId 的 ${field} 不一致`);
    }
  }
  if (actorUserId !== undefined && String(transaction.actorUserId || "") !== String(actorUserId || "")) {
    throw operationConflict("同一 operationId 的结算操作人不一致");
  }
  if (reason !== undefined && transaction.reason !== reason) {
    throw operationConflict("同一 operationId 的结算原因不一致");
  }
}

async function createOperation(data) {
  try {
    const transaction = await CreditTransaction.create(data);
    return { transaction, created: true };
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const transaction = await CreditTransaction.findOne({ operationId: data.operationId });
    if (!transaction) throw error;
    if (data.userId && String(transaction.userId) !== String(data.userId)) {
      throw new CreditError("operationId 已被其他用户使用", {
        code: "CREDIT_OPERATION_CONFLICT",
        statusCode: 409,
      });
    }
    return { transaction, created: false };
  }
}

async function rejectTransaction(transaction, reason, balance = null) {
  const rejected = await CreditTransaction.findOneAndUpdate(
    { _id: transaction._id, status: "pending" },
    {
      $set: {
        status: "rejected",
        reserved: 0,
        refunded: 0,
        reason,
        balanceBefore: balance,
        balanceAfter: balance,
      },
    },
    { new: true, runValidators: true },
  );
  return rejected || CreditTransaction.findById(transaction._id);
}

export async function reserveCredits({
  operationId,
  userId,
  points,
  actorUserId = null,
  type = "model_usage",
  feature = "",
  provider = "",
  model = "",
  usage = null,
  pricingSnapshot = null,
  upstreamRequestIds = [],
  reason = "",
  executionClaimId = null,
} = {}) {
  await dbConnect();
  const normalizedOperationId = normalizeOperationId(operationId);
  assertObjectId(userId, "userId");
  if (actorUserId !== null) assertObjectId(actorUserId, "actorUserId");
  assertPoints(points, "points");
  const normalizedClaimId = executionClaimId === null
    ? null
    : normalizeClaimId(executionClaimId);
  const normalizedRequestIds = normalizeStringArray(upstreamRequestIds, "upstreamRequestIds");
  const requestHash = reservationRequestHash({
    userId,
    actorUserId,
    points,
    type,
    feature,
    provider,
    model,
    usage,
    pricingSnapshot,
    upstreamRequestIds: normalizedRequestIds,
    reason,
  });
  const auditUserKey = await resolveAuditUserKey(userId);
  const operation = await createOperation({
    operationId: normalizedOperationId,
    userId,
    auditUserKey,
    actorUserId,
    type,
    feature,
    provider,
    model,
    status: "pending",
    requested: points,
    reserved: points,
    charged: 0,
    refunded: 0,
    usage,
    pricingSnapshot,
    upstreamRequestIds: normalizedRequestIds,
    reservationRequestHash: requestHash,
    ...(normalizedClaimId ? { executionClaimId: normalizedClaimId, claimedAt: new Date() } : {}),
    reason,
  });
  let transaction = operation.transaction;
  if (!operation.created) {
    assertReservationReplay(transaction, {
      userId,
      actorUserId,
      points,
      type,
      feature,
      provider,
      model,
      usage,
      pricingSnapshot,
      upstreamRequestIds: normalizedRequestIds,
      reason,
    });
    if (normalizedClaimId && transaction.executionClaimId !== normalizedClaimId) {
      if (TERMINAL_STATUSES.has(transaction.status)) {
        throw new CreditError("本次请求已经处理完成，请勿重复提交", {
          code: "CREDIT_OPERATION_ALREADY_PROCESSED",
          statusCode: 409,
          details: { status: transaction.status },
        });
      }
      throw new CreditError("本次请求已在处理中，请勿重复提交", {
        code: "CREDIT_OPERATION_ALREADY_CLAIMED",
        statusCode: 409,
        details: { status: transaction.status },
      });
    }
    if (transaction.status !== "pending") return plain(transaction);
  }

  const user = await User.findOne({ _id: userId, deletionInProgress: { $ne: true } })
    .select("email creditBalance creditHeld creditHolds")
    .lean();
  if (!user) {
    transaction = await rejectTransaction(transaction, "用户不存在");
    throw new CreditError("用户不存在", {
      code: "CREDIT_USER_NOT_FOUND",
      statusCode: 404,
      details: { transaction: plain(transaction) },
    });
  }

  if (isAdminEmail(user.email)) {
    transaction = await CreditTransaction.findOneAndUpdate(
      { _id: transaction._id, status: "pending" },
      {
        $set: {
          status: "reserved",
          reserved: 0,
          walletExempt: true,
          balanceBefore: user.creditBalance,
          balanceAfter: user.creditBalance,
        },
      },
      { new: true, runValidators: true },
    );
    return plain(transaction || await CreditTransaction.findById(operation.transaction._id));
  }

  const now = new Date();
  const updatedUser = await User.findOneAndUpdate(
    {
      _id: userId,
      deletionInProgress: { $ne: true },
      creditBalance: { $gte: points },
      "creditHolds.operationId": { $ne: normalizedOperationId },
    },
    {
      $inc: { creditBalance: -points, creditHeld: points, creditVersion: 1 },
      $set: { creditLastOperationId: normalizedOperationId },
      $push: {
        creditHolds: {
          operationId: normalizedOperationId,
          points,
          createdAt: now,
        },
      },
    },
    { new: true, runValidators: true },
  ).select("creditBalance creditHeld creditHolds");

  if (!updatedUser) {
    const current = await User.findOne({ _id: userId, deletionInProgress: { $ne: true } })
      .select("creditBalance creditHeld creditHolds")
      .lean();
    const existingHold = current?.creditHolds?.find(
      (hold) => hold.operationId === normalizedOperationId,
    );
    if (existingHold) {
      if (existingHold.points !== points) {
        throw new CreditError("已有冻结积分与本次请求不一致", {
          code: "CREDIT_HOLD_CONFLICT",
          statusCode: 409,
        });
      }
      transaction = await CreditTransaction.findOneAndUpdate(
        { _id: transaction._id, status: "pending" },
        {
          $set: {
            status: "reserved",
            balanceBefore: current.creditBalance + points,
            balanceAfter: current.creditBalance,
          },
        },
        { new: true, runValidators: true },
      );
      return plain(transaction || await CreditTransaction.findById(operation.transaction._id));
    }
    transaction = await rejectTransaction(transaction, "积分余额不足", current?.creditBalance ?? null);
    throw new InsufficientCreditsError({
      required: points,
      available: current?.creditBalance ?? 0,
      transaction: plain(transaction),
    });
  }

  transaction = await CreditTransaction.findOneAndUpdate(
    { _id: transaction._id, status: "pending" },
    {
      $set: {
        status: "reserved",
        balanceBefore: updatedUser.creditBalance + points,
        balanceAfter: updatedUser.creditBalance,
      },
    },
    { new: true, runValidators: true },
  );
  return plain(transaction || await CreditTransaction.findById(operation.transaction._id));
}

function findSettlementReceipt(user, operationId) {
  return user?.creditSettlementReceipts?.find(
    (receipt) => receipt.operationId === operationId,
  ) || null;
}

function receiptHasValidShape(receipt, kind) {
  return Boolean(
    receipt
    && receipt.kind === kind
    && Number.isSafeInteger(receipt.balanceBefore)
    && receipt.balanceBefore >= 0
    && Number.isSafeInteger(receipt.balanceAfter)
    && receipt.balanceAfter >= 0
    && Number.isSafeInteger(receipt.creditVersionBefore)
    && receipt.creditVersionBefore >= 0
    && receipt.creditVersionAfter === receipt.creditVersionBefore + 1
    && receipt.appliedAt,
  );
}

async function clearSettlementReceipt(userId, operationId) {
  if (!userId) return;
  await User.updateOne(
    { _id: userId, "creditSettlementReceipts.operationId": operationId },
    { $pull: { creditSettlementReceipts: { operationId } } },
    { runValidators: true },
  );
}

async function clearSettlementReceiptQuietly(userId, operationId) {
  try {
    await clearSettlementReceipt(userId, operationId);
  } catch (error) {
    console.error("[Credits] 清理钱包结算回执失败", {
      errorType: error?.name || "Error",
      code: error?.code || "",
    });
  }
}

async function failSettlement(transaction, reason, code, message) {
  await CreditTransaction.updateOne(
    { _id: transaction._id, status: "settling" },
    { $set: { status: "review_required", reason } },
    { runValidators: true },
  );
  throw new CreditError(message, { code, statusCode: 409 });
}

export async function settleCredits({
  operationId,
  chargedPoints,
  actualCostCny,
  actualCostUsd,
  usage,
  pricingSnapshot,
  upstreamRequestIds,
  allowAdditionalDebit = false,
  actorUserId,
  reason,
} = {}) {
  await dbConnect();
  const normalizedOperationId = normalizeOperationId(operationId);
  assertPoints(chargedPoints, "chargedPoints");
  assertOptionalAmount(actualCostCny, "actualCostCny");
  assertOptionalAmount(actualCostUsd, "actualCostUsd");
  if (actorUserId !== undefined && actorUserId !== null) assertObjectId(actorUserId, "actorUserId");
  const normalizedReason = reason === undefined
    ? undefined
    : (typeof reason === "string" ? reason.trim() : "");
  if (reason !== undefined && !normalizedReason) {
    throw invalidCreditArgument("reason 必须是非空字符串");
  }
  const normalizedRequestIds = normalizeStringArray(upstreamRequestIds, "upstreamRequestIds");
  const settlementIntent = {
    status: "settling",
    charged: chargedPoints,
  };
  if (actualCostCny !== undefined) settlementIntent.actualCostCny = actualCostCny;
  if (actualCostUsd !== undefined) settlementIntent.actualCostUsd = actualCostUsd;
  if (usage !== undefined) settlementIntent.usage = usage;
  if (pricingSnapshot !== undefined) settlementIntent.pricingSnapshot = pricingSnapshot;
  if (normalizedRequestIds !== undefined) {
    settlementIntent.upstreamRequestIds = normalizedRequestIds;
  }
  if (actorUserId !== undefined) settlementIntent.actorUserId = actorUserId || null;
  if (normalizedReason !== undefined) settlementIntent.reason = normalizedReason;
  let transaction = await CreditTransaction.findOneAndUpdate(
    {
      operationId: normalizedOperationId,
      status: { $in: ["reserved", "review_required"] },
      ...(allowAdditionalDebit ? {} : {
        $or: [
          { walletExempt: true },
          { reserved: { $gte: chargedPoints } },
        ],
      }),
    },
    { $set: settlementIntent },
    { new: true, runValidators: true },
  );
  if (!transaction) {
    transaction = await CreditTransaction.findOne({ operationId: normalizedOperationId });
    if (!transaction) {
      throw new CreditError("积分流水不存在", {
        code: "CREDIT_TRANSACTION_NOT_FOUND",
        statusCode: 404,
      });
    }
    if (TERMINAL_STATUSES.has(transaction.status)) {
      assertSettlementReplay(transaction, {
        chargedPoints,
        actualCostCny,
        actualCostUsd,
        usage,
        pricingSnapshot,
        upstreamRequestIds: normalizedRequestIds,
        actorUserId,
        reason: normalizedReason,
      });
      await clearSettlementReceiptQuietly(transaction.userId, normalizedOperationId);
      return plain(transaction);
    }
    if (
      ["reserved", "review_required"].includes(transaction.status)
      && !transaction.walletExempt
      && chargedPoints > transaction.reserved
    ) {
      await CreditTransaction.updateOne(
        { _id: transaction._id, status: transaction.status },
        {
          $set: {
            ...settlementIntent,
            status: "review_required",
            reason: "实际积分超过预留积分",
          },
        },
        { runValidators: true },
      );
      throw new CreditError("实际积分不能超过预留积分，流水已转人工复核", {
        code: "CREDIT_CHARGE_EXCEEDS_RESERVATION",
        statusCode: 409,
      });
    }
    if (transaction.status !== "settling") {
      throw new CreditError("积分流水当前不能结算", {
        code: "CREDIT_TRANSACTION_STATE_CONFLICT",
        statusCode: 409,
        details: { status: transaction.status },
      });
    }
    assertSettlementReplay(transaction, {
      chargedPoints,
      actualCostCny,
      actualCostUsd,
      usage,
      pricingSnapshot,
      upstreamRequestIds: normalizedRequestIds,
      actorUserId,
      reason: normalizedReason,
    });
  }

  const settlementCharge = transaction.charged;
  const refunded = transaction.walletExempt
    ? 0
    : Math.max(0, transaction.reserved - settlementCharge);
  const additionalDebit = transaction.walletExempt
    ? 0
    : Math.max(0, settlementCharge - transaction.reserved);
  let balanceAfter = transaction.balanceAfter;
  if (!transaction.walletExempt && transaction.userId) {
    let appliedReceipt = null;
    for (let attempt = 0; attempt < 5 && !appliedReceipt; attempt += 1) {
      const current = await User.findById(transaction.userId)
        .select("creditBalance creditHeld creditHolds creditSettlementReceipts creditVersion")
        .lean();
      if (!current) {
        await failSettlement(
          transaction,
          "结算时用户不存在，无法确认钱包状态",
          "CREDIT_USER_NOT_FOUND",
          "结算时用户不存在，流水已转人工复核",
        );
      }
      const hold = current.creditHolds?.find(
        (item) => item.operationId === normalizedOperationId,
      ) || null;
      const receipt = findSettlementReceipt(current, normalizedOperationId);
      if (hold && receipt) {
        await failSettlement(
          transaction,
          "冻结积分与钱包结算回执同时存在",
          "CREDIT_SETTLEMENT_RECEIPT_CONFLICT",
          "钱包结算状态冲突，流水已转人工复核",
        );
      }
      if (receipt) {
        if (
          !receiptHasValidShape(receipt, "model_settlement")
          || receipt.balanceAfter !== receipt.balanceBefore + refunded - additionalDebit
        ) {
          await failSettlement(
            transaction,
            "钱包结算回执无效",
            "CREDIT_SETTLEMENT_RECEIPT_INVALID",
            "钱包结算回执无效，流水已转人工复核",
          );
        }
        appliedReceipt = receipt;
        break;
      }
      if (!hold) {
        const latest = await CreditTransaction.findById(transaction._id);
        if (latest && TERMINAL_STATUSES.has(latest.status)) {
          assertSettlementReplay(latest, {
            chargedPoints,
            actualCostCny,
            actualCostUsd,
            usage,
            pricingSnapshot,
            upstreamRequestIds: normalizedRequestIds,
            actorUserId,
            reason: normalizedReason,
          });
          await clearSettlementReceiptQuietly(latest.userId, normalizedOperationId);
          return plain(latest);
        }
        await failSettlement(
          transaction,
          "未找到冻结积分或钱包结算回执",
          "CREDIT_SETTLEMENT_STATE_UNKNOWN",
          "无法确认钱包是否已经结算，流水已转人工复核",
        );
      }
      if (
        hold.points !== transaction.reserved
        || !Number.isSafeInteger(current.creditHeld)
        || current.creditHeld < transaction.reserved
      ) {
        await failSettlement(
          transaction,
          "冻结积分状态不一致",
          "CREDIT_HOLD_CONFLICT",
          "冻结积分状态不一致，流水已转人工复核",
        );
      }
      if (!Number.isSafeInteger(current.creditBalance) || !Number.isSafeInteger(current.creditVersion)) {
        await failSettlement(
          transaction,
          "钱包余额或版本无效",
          "CREDIT_WALLET_INVALID",
          "钱包状态无效，流水已转人工复核",
        );
      }
      if (current.creditBalance < additionalDebit) {
        await failSettlement(
          transaction,
          "可用积分不足以补扣已确认的超额成本",
          "CREDIT_ADDITIONAL_DEBIT_INSUFFICIENT",
          "可用积分不足以补扣已确认的超额成本，流水已转人工复核",
        );
      }
      const nextBalance = current.creditBalance + refunded - additionalDebit;
      const nextVersion = current.creditVersion + 1;
      assertPoints(nextBalance, "balanceAfter");
      assertPoints(nextVersion, "creditVersionAfter");
      const receiptRecord = {
        operationId: normalizedOperationId,
        kind: "model_settlement",
        balanceBefore: current.creditBalance,
        balanceAfter: nextBalance,
        creditVersionBefore: current.creditVersion,
        creditVersionAfter: nextVersion,
        appliedAt: new Date(),
      };
      const updatedUser = await User.findOneAndUpdate(
        {
          _id: transaction.userId,
          creditBalance: current.creditBalance,
          creditVersion: current.creditVersion,
          creditHeld: { $gte: transaction.reserved },
          creditHolds: {
            $elemMatch: {
              operationId: normalizedOperationId,
              points: transaction.reserved,
            },
          },
          "creditSettlementReceipts.operationId": { $ne: normalizedOperationId },
        },
        {
          $inc: {
            creditHeld: -transaction.reserved,
            creditBalance: refunded - additionalDebit,
            creditVersion: 1,
          },
          $set: { creditLastOperationId: normalizedOperationId },
          $pull: { creditHolds: { operationId: normalizedOperationId } },
          $push: { creditSettlementReceipts: receiptRecord },
        },
        { new: true, runValidators: true },
      ).select("creditBalance");
      if (updatedUser) appliedReceipt = receiptRecord;
    }
    if (!appliedReceipt) {
      await failSettlement(
        transaction,
        "钱包在结算期间被连续修改",
        "CREDIT_SETTLEMENT_CONFLICT",
        "钱包正在被其他操作修改，流水已转人工复核",
      );
    }
    balanceAfter = appliedReceipt.balanceAfter;
  }

  const updates = {
    status: transaction.walletExempt || settlementCharge > 0 ? "settled" : "released",
    charged: settlementCharge,
    refunded,
    balanceAfter,
  };
  const transactionId = transaction._id;
  transaction = await CreditTransaction.findOneAndUpdate(
    { _id: transactionId, status: "settling" },
    { $set: updates },
    { new: true, runValidators: true },
  );
  transaction = transaction || await CreditTransaction.findById(transactionId);
  if (transaction && TERMINAL_STATUSES.has(transaction.status)) {
    await clearSettlementReceiptQuietly(transaction.userId, normalizedOperationId);
  }
  return plain(transaction);
}

export async function markReviewRequired(operationId, {
  reason = "需要人工复核",
  usage,
  upstreamRequestIds,
  actualCostCny,
  actualCostUsd,
} = {}) {
  await dbConnect();
  const normalizedOperationId = normalizeOperationId(operationId);
  if (typeof reason !== "string" || !reason.trim()) {
    throw invalidCreditArgument("reason 必须是非空字符串");
  }
  assertOptionalAmount(actualCostCny, "actualCostCny");
  assertOptionalAmount(actualCostUsd, "actualCostUsd");
  const normalizedRequestIds = normalizeStringArray(upstreamRequestIds, "upstreamRequestIds");
  const updates = { status: "review_required", reason: reason.trim() };
  if (usage !== undefined) updates.usage = usage;
  if (actualCostCny !== undefined) updates.actualCostCny = actualCostCny;
  if (actualCostUsd !== undefined) updates.actualCostUsd = actualCostUsd;
  const update = { $set: updates };
  if (normalizedRequestIds?.length) {
    update.$addToSet = { upstreamRequestIds: { $each: normalizedRequestIds } };
  }
  const transaction = await CreditTransaction.findOneAndUpdate(
    { operationId: normalizedOperationId, status: { $in: ["reserved", "review_required"] } },
    update,
    { new: true, runValidators: true },
  );
  if (transaction) return plain(transaction);
  const existing = await CreditTransaction.findOne({ operationId: normalizedOperationId });
  if (!existing) {
    throw new CreditError("积分流水不存在", {
      code: "CREDIT_TRANSACTION_NOT_FOUND",
      statusCode: 404,
    });
  }
  return plain(existing);
}

export async function releaseCredits(operationId, details = {}) {
  return settleCredits({
    operationId,
    ...details,
    chargedPoints: 0,
  });
}

export async function adjustBalance({
  operationId,
  userId,
  targetBalance,
  actorUserId,
  reason,
} = {}) {
  await dbConnect();
  const normalizedOperationId = normalizeOperationId(operationId);
  assertObjectId(userId, "userId");
  assertObjectId(actorUserId, "actorUserId");
  assertPoints(targetBalance, "targetBalance");
  if (typeof reason !== "string" || !reason.trim()) {
    throw invalidCreditArgument("reason 必须是非空字符串");
  }
  const auditUserKey = await resolveAuditUserKey(userId);
  const operation = await createOperation({
    operationId: normalizedOperationId,
    userId,
    auditUserKey,
    actorUserId,
    type: "admin_set",
    status: "pending",
    requested: 0,
    usage: { targetAvailableBalance: targetBalance },
    reason: reason.trim(),
  });
  let transaction = operation.transaction;
  if (String(transaction.userId) !== String(userId)) {
    throw operationConflict("同一 operationId 的用户不一致");
  }
  if (String(transaction.actorUserId || "") !== String(actorUserId)) {
    throw operationConflict("同一 operationId 的操作人不一致");
  }
  if (transaction.usage?.targetAvailableBalance !== targetBalance) {
    throw operationConflict("同一 operationId 的目标余额不一致");
  }
  if (transaction.reason !== reason.trim()) {
    throw operationConflict("同一 operationId 的调整原因不一致");
  }
  const finalizeAppliedAdjustment = async (receipt) => {
    if (
      !receiptHasValidShape(receipt, "admin_set")
      || receipt.balanceBefore !== transaction.balanceBefore
      || receipt.balanceAfter !== targetBalance
      || receipt.creditVersionBefore !== transaction.usage?.creditVersionBefore
    ) {
      await CreditTransaction.updateOne(
        { _id: transaction._id, status: "settling" },
        { $set: { status: "review_required", reason: "管理员调分钱包回执无效" } },
        { runValidators: true },
      );
      throw new CreditError("管理员调分回执无效，无法确认结果", {
        code: "CREDIT_ADMIN_RECEIPT_INVALID",
        statusCode: 409,
      });
    }
    const completed = await CreditTransaction.findOneAndUpdate(
      { _id: transaction._id, status: { $in: ["settling", "review_required"] } },
      {
        $set: {
          status: "settled",
          reason: reason.trim(),
          balanceBefore: receipt.balanceBefore,
          balanceAfter: targetBalance,
          usage: {
            targetAvailableBalance: targetBalance,
            creditVersionBefore: receipt.creditVersionBefore,
            creditVersionAfter: receipt.creditVersionAfter,
          },
        },
      },
      { new: true, runValidators: true },
    );
    const resolved = completed || await CreditTransaction.findById(transaction._id);
    if (resolved?.status === "settled") {
      await clearSettlementReceiptQuietly(resolved.userId, normalizedOperationId);
    }
    return plain(resolved);
  };

  if (transaction.status === "settled") {
    await clearSettlementReceiptQuietly(transaction.userId, normalizedOperationId);
    return plain(transaction);
  }
  if (transaction.status === "pending") {
    const currentUser = await User.findOne({ _id: userId, deletionInProgress: { $ne: true } })
      .select("creditBalance creditVersion")
      .lean();
    if (!currentUser) {
      transaction = await rejectTransaction(transaction, "用户不存在");
      throw new CreditError("用户不存在", {
        code: "CREDIT_USER_NOT_FOUND",
        statusCode: 404,
        details: { transaction: plain(transaction) },
      });
    }
    assertPoints(currentUser.creditBalance, "creditBalance");
    assertPoints(currentUser.creditVersion, "creditVersion");
    transaction = await CreditTransaction.findOneAndUpdate(
      { _id: transaction._id, status: "pending" },
      {
        $set: {
          status: "settling",
          balanceBefore: currentUser.creditBalance,
          usage: {
            targetAvailableBalance: targetBalance,
            creditVersionBefore: currentUser.creditVersion,
          },
        },
      },
      { new: true, runValidators: true },
    ) || await CreditTransaction.findById(transaction._id);
  }
  if (transaction.status === "settled") {
    await clearSettlementReceiptQuietly(transaction.userId, normalizedOperationId);
    return plain(transaction);
  }

  const balanceBefore = transaction.balanceBefore;
  const creditVersionBefore = transaction.usage?.creditVersionBefore;
  if (!["settling", "review_required"].includes(transaction.status)) {
    throw new CreditError("目标余额尚未设置成功，请刷新后使用新的操作号重试", {
      code: "CREDIT_ADMIN_ADJUSTMENT_NOT_APPLIED",
      statusCode: 409,
      details: { status: transaction.status },
    });
  }
  assertPoints(balanceBefore, "balanceBefore");
  assertPoints(creditVersionBefore, "creditVersionBefore");

  const currentUser = await User.findById(userId)
    .select("creditBalance creditVersion creditSettlementReceipts deletionInProgress")
    .lean();
  const existingReceipt = findSettlementReceipt(currentUser, normalizedOperationId);
  if (existingReceipt) {
    return finalizeAppliedAdjustment(existingReceipt);
  }
  if (transaction.status === "review_required") {
    throw new CreditError("无法确认上次调整是否已应用，请使用新的操作号重试", {
      code: "CREDIT_ADMIN_ADJUSTMENT_NOT_APPLIED",
      statusCode: 409,
      details: { status: transaction.status },
    });
  }
  if (!currentUser || currentUser.deletionInProgress) {
    transaction = await CreditTransaction.findOneAndUpdate(
      { _id: transaction._id, status: "settling" },
      {
        $set: {
          status: "rejected",
          reason: currentUser ? "用户正在删除，目标余额未设置" : "用户不存在，目标余额未设置",
        },
      },
      { new: true, runValidators: true },
    ) || await CreditTransaction.findById(transaction._id);
    throw new CreditError(currentUser ? "用户正在删除，本次设置未生效" : "用户不存在，本次设置未生效", {
      code: currentUser ? "CREDIT_USER_DELETING" : "CREDIT_USER_NOT_FOUND",
      statusCode: currentUser ? 409 : 404,
      details: { status: transaction?.status },
    });
  }

  const adjustmentReceipt = {
    operationId: normalizedOperationId,
    kind: "admin_set",
    balanceBefore,
    balanceAfter: targetBalance,
    creditVersionBefore,
    creditVersionAfter: creditVersionBefore + 1,
    appliedAt: new Date(),
  };

  const updatedUser = await User.findOneAndUpdate(
    {
      _id: userId,
      deletionInProgress: { $ne: true },
      creditVersion: creditVersionBefore,
      creditBalance: balanceBefore,
      "creditSettlementReceipts.operationId": { $ne: normalizedOperationId },
    },
    {
      $set: {
        creditBalance: targetBalance,
        creditLastOperationId: normalizedOperationId,
      },
      $inc: { creditVersion: 1 },
      $push: { creditSettlementReceipts: adjustmentReceipt },
    },
    { new: true, runValidators: true },
  ).select("creditBalance creditVersion");
  if (updatedUser) {
    return finalizeAppliedAdjustment(adjustmentReceipt);
  }

  const userAfterConflict = await User.findById(userId)
    .select("creditSettlementReceipts")
    .lean();
  const appliedAfterConflict = findSettlementReceipt(userAfterConflict, normalizedOperationId);
  if (appliedAfterConflict) {
    return finalizeAppliedAdjustment(appliedAfterConflict);
  }

  transaction = await CreditTransaction.findOneAndUpdate(
    { _id: transaction._id, status: "settling" },
    {
      $set: {
        status: "rejected",
        reason: userAfterConflict
          ? "钱包已被其他积分操作更新，本次目标余额未设置"
          : "用户已不存在，本次目标余额未设置",
      },
    },
    { new: true, runValidators: true },
  ) || await CreditTransaction.findById(transaction._id);
  throw new CreditError("积分余额刚被其他操作更新，本次设置未生效，请重试", {
    code: "CREDIT_ADMIN_ADJUSTMENT_CONFLICT",
    statusCode: 409,
    details: { status: transaction?.status },
  });
}

export async function getCreditSummary(userId) {
  await dbConnect();
  assertObjectId(userId, "userId");
  const user = await User.findById(userId)
    .select("email creditBalance creditHeld creditVersion")
    .lean();
  if (!user) {
    throw new CreditError("用户不存在", {
      code: "CREDIT_USER_NOT_FOUND",
      statusCode: 404,
    });
  }
  assertPoints(user.creditBalance, "creditBalance");
  assertPoints(user.creditHeld, "creditHeld");
  assertPoints(user.creditVersion, "creditVersion");
  return {
    userId: user._id.toString(),
    version: user.creditVersion,
    unlimited: isAdminEmail(user.email),
    availablePoints: user.creditBalance,
    heldPoints: user.creditHeld,
    totalPoints: user.creditBalance + user.creditHeld,
  };
}

function encodeCursor(transaction) {
  return Buffer.from(JSON.stringify({
    createdAt: transaction.createdAt.toISOString(),
    id: transaction._id.toString(),
  })).toString("base64url");
}

function decodeCursor(cursor) {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime()) || !mongoose.isValidObjectId(parsed.id)) throw new Error();
    return { createdAt, id: new mongoose.Types.ObjectId(parsed.id) };
  } catch {
    throw invalidCreditArgument("cursor 无效");
  }
}

export async function listTransactions(userId, { cursor = null, limit = 20 } = {}) {
  await dbConnect();
  assertObjectId(userId, "userId");
  if (!Number.isInteger(limit) || limit < 1) {
    throw invalidCreditArgument("limit 必须是正整数");
  }
  const pageSize = Math.min(limit, 100);
  const filter = { userId };
  if (cursor) {
    const decoded = decodeCursor(cursor);
    filter.$or = [
      { createdAt: { $lt: decoded.createdAt } },
      { createdAt: decoded.createdAt, _id: { $lt: decoded.id } },
    ];
  }
  const documents = await CreditTransaction.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(pageSize + 1)
    .lean();
  const hasMore = documents.length > pageSize;
  const items = hasMore ? documents.slice(0, pageSize) : documents;
  return {
    items,
    nextCursor: hasMore ? encodeCursor(items[items.length - 1]) : null,
  };
}

async function reconcilePendingModelUsage(transaction) {
  const user = await User.findById(transaction.userId)
    .select("email creditBalance creditHolds")
    .lean();
  if (!user) {
    await rejectTransaction(transaction, "对账时用户不存在");
    return "rejected";
  }
  if (isAdminEmail(user.email)) {
    await CreditTransaction.updateOne(
      { _id: transaction._id, status: "pending" },
      {
        $set: {
          status: "reserved",
          walletExempt: true,
          reserved: 0,
          balanceBefore: user.creditBalance,
          balanceAfter: user.creditBalance,
        },
      },
      { runValidators: true },
    );
    return "reserved";
  }
  const hold = user.creditHolds?.find((item) => item.operationId === transaction.operationId);
  if (!hold) {
    await rejectTransaction(transaction, "对账未发现对应冻结积分", user.creditBalance);
    return "rejected";
  }
  if (hold.points !== transaction.reserved) {
    await CreditTransaction.updateOne(
      { _id: transaction._id, status: "pending" },
      { $set: { status: "review_required", reason: "对账发现冻结积分不一致" } },
    );
    return "review_required";
  }
  await CreditTransaction.updateOne(
    { _id: transaction._id, status: "pending" },
    {
      $set: {
        status: "reserved",
        balanceBefore: user.creditBalance + transaction.reserved,
        balanceAfter: user.creditBalance,
      },
    },
    { runValidators: true },
  );
  return "reserved";
}

async function reconcilePendingRegistrationGrant(transaction) {
  const initialCredits = transaction.usage?.initialCredits;
  if (!Number.isSafeInteger(initialCredits) || initialCredits < 0) {
    await CreditTransaction.updateOne(
      { _id: transaction._id, status: "pending", updatedAt: transaction.updatedAt },
      { $set: { status: "review_required", reason: "注册流水中的初始积分无效" } },
    );
    return "review_required";
  }
  if (!mongoose.isValidObjectId(transaction.userId)) {
    await CreditTransaction.updateOne(
      { _id: transaction._id, status: "pending", updatedAt: transaction.updatedAt },
      { $set: { status: "rejected", reason: "注册积分对账缺少有效用户" } },
    );
    return "rejected";
  }
  let user = await User.collection.findOneAndUpdate(
    {
      _id: new mongoose.Types.ObjectId(String(transaction.userId)),
      creditsInitializedAt: { $exists: false },
    },
    {
      $set: {
        creditBalance: initialCredits,
        creditHeld: 0,
        creditHolds: [],
        creditSettlementReceipts: [],
        creditVersion: 0,
        creditLastOperationId: transaction.operationId,
        creditInitializationOperationId: transaction.operationId,
        creditsInitializedAt: new Date(),
      },
    },
    {
      returnDocument: "after",
      includeResultMetadata: false,
      projection: {
        creditBalance: 1,
        creditHeld: 1,
        creditHolds: 1,
        creditsInitializedAt: 1,
        creditInitializationOperationId: 1,
      },
    },
  );
  if (!user) {
    user = await User.findById(transaction.userId)
      .select("creditBalance creditHeld creditHolds creditsInitializedAt creditInitializationOperationId")
      .lean();
  }
  if (!user) {
    await CreditTransaction.updateOne(
      { _id: transaction._id, status: "pending", updatedAt: transaction.updatedAt },
      { $set: { status: "rejected", reason: "注册积分对账时用户不存在" } },
    );
    return "rejected";
  }
  if (
    !user.creditsInitializedAt
    || user.creditInitializationOperationId !== transaction.operationId
  ) {
    await CreditTransaction.updateOne(
      { _id: transaction._id, status: "pending", updatedAt: transaction.updatedAt },
      { $set: { status: "review_required", reason: "注册流水与用户钱包金额不一致" } },
    );
    return "review_required";
  }
  await CreditTransaction.updateOne(
    { _id: transaction._id, status: "pending", updatedAt: transaction.updatedAt },
    {
      $set: {
        status: "settled",
        balanceBefore: 0,
        balanceAfter: initialCredits,
        usage: { initialCredits, initializedAt: user.creditsInitializedAt },
      },
    },
    { runValidators: true },
  );
  return "settled";
}

async function cleanupTerminalSettlementReceipts(limit) {
  const users = await User.find({
    "creditSettlementReceipts.0": { $exists: true },
  })
    .select("creditSettlementReceipts")
    .limit(limit)
    .lean();
  let cleared = 0;
  let remaining = limit;
  for (const user of users) {
    if (remaining <= 0) break;
    const operationIds = (user.creditSettlementReceipts || [])
      .map((receipt) => receipt?.operationId)
      .filter((value) => typeof value === "string" && value)
      .slice(0, remaining);
    remaining -= operationIds.length;
    if (operationIds.length === 0) continue;
    const terminalIds = await CreditTransaction.find({
      operationId: { $in: operationIds },
      status: { $in: Array.from(TERMINAL_STATUSES) },
    }).distinct("operationId");
    if (terminalIds.length === 0) continue;
    const updated = await User.updateOne(
      { _id: user._id },
      {
        $pull: {
          creditSettlementReceipts: { operationId: { $in: terminalIds } },
        },
      },
      { runValidators: true },
    );
    if (updated.modifiedCount === 1) cleared += terminalIds.length;
  }
  return cleared;
}

const PRIVATE_USAGE_KEYS = new Set([
  "userid",
  "profileid",
  "voiceid",
  "upstreamvoiceid",
  "requestfingerprint",
  "conversationid",
  "usermessageid",
  "modelmessageid",
  "fileid",
  "fileids",
  "audiofileid",
  "videofileid",
  "samplefileid",
  "uploadticketid",
  "clienttoken",
  "operationid",
  "email",
  "displayname",
  "voicename",
  "sourcename",
  "filename",
  "originalname",
]);

function isPrivateUsageKey(key) {
  const normalized = key.toLowerCase();
  return PRIVATE_USAGE_KEYS.has(normalized)
    || /(?:user|profile|voice|file|conversation|message|upload|task|token).*ids?$/.test(normalized);
}

function anonymizeUsageValue(value, deletedUserId, depth = 0) {
  if (depth > 24 || value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return value === deletedUserId ? null : value;
  if (["number", "boolean"].includes(typeof value)) return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) {
    return value.map((item) => anonymizeUsageValue(item, deletedUserId, depth + 1));
  }
  if (value && typeof value.toHexString === "function") {
    return value.toString() === deletedUserId ? null : value;
  }
  if (value && typeof value === "object") {
    const output = {};
    for (const [key, nested] of Object.entries(value)) {
      if (isPrivateUsageKey(key)) continue;
      output[key] = anonymizeUsageValue(nested, deletedUserId, depth + 1);
    }
    return output;
  }
  return null;
}

function anonymousOperationId(transaction) {
  const auditKey = typeof transaction.auditUserKey === "string" && transaction.auditUserKey
    ? transaction.auditUserKey
    : crypto.createHash("sha256").update(String(transaction._id)).digest("hex").slice(0, 36);
  return `anonymous:${auditKey}:${transaction._id}`;
}

async function anonymizeOwnedTransactions(documents) {
  if (!documents.length) return 0;
  const operations = documents.map((transaction) => ({
    updateOne: {
      filter: { _id: transaction._id, userId: transaction.userId },
      update: {
        $set: {
          userId: null,
          operationId: anonymousOperationId(transaction),
          usage: anonymizeUsageValue(transaction.usage, String(transaction.userId || "")),
          ...(transaction.type === "admin_set"
            ? { reason: "管理员调整（账号已删除）" }
            : {}),
        },
        $unset: {
          reservationRequestHash: 1,
          executionClaimId: 1,
          claimedAt: 1,
        },
      },
    },
  }));
  const result = await CreditTransaction.bulkWrite(operations, { ordered: false });
  return result.modifiedCount || 0;
}

async function findOrphanedTransactions(field, limit) {
  return CreditTransaction.aggregate([
    { $match: { [field]: { $type: "objectId" } } },
    {
      $lookup: {
        from: User.collection.collectionName,
        localField: field,
        foreignField: "_id",
        as: "linkedUser",
      },
    },
    { $match: { "linkedUser.0": { $exists: false } } },
    { $project: { linkedUser: 0 } },
    { $limit: limit },
  ]);
}

export async function anonymizeOrphanedTransactions({ limit = 100 } = {}) {
  await dbConnect();
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw invalidCreditArgument("孤儿流水清理数量必须是 1 到 1000 的整数");
  }
  const [owned, acted] = await Promise.all([
    findOrphanedTransactions("userId", limit),
    findOrphanedTransactions("actorUserId", limit),
  ]);
  const [ownedCount, actedResult] = await Promise.all([
    anonymizeOwnedTransactions(owned),
    acted.length
      ? CreditTransaction.updateMany(
        { _id: { $in: acted.map((item) => item._id) } },
        { $set: { actorUserId: null } },
      )
      : null,
  ]);
  return {
    anonymizedTransactions: ownedCount,
    anonymizedActorReferences: actedResult?.modifiedCount || 0,
  };
}

export async function reconcileCreditTransactions({ limit = 100 } = {}) {
  await dbConnect();
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw invalidCreditArgument("limit 必须是 1 到 1000 的整数");
  }
  const now = Date.now();
  const transactions = await CreditTransaction.find({
    $or: [
      {
        status: "pending",
        updatedAt: { $lte: new Date(now - PENDING_RECOVERY_STALE_MS) },
      },
      {
        status: "settling",
        updatedAt: { $lte: new Date(now - SETTLING_RECOVERY_STALE_MS) },
      },
      {
        status: "reserved",
        executionClaimId: { $type: "string", $ne: "" },
        claimedAt: { $lte: new Date(now - CLAIMED_EXECUTION_STALE_MS) },
      },
    ],
  })
    .sort({ createdAt: 1, _id: 1 })
    .limit(limit);
  const result = {
    scanned: transactions.length,
    reserved: 0,
    settled: 0,
    released: 0,
    rejected: 0,
    reviewRequired: 0,
    registrationPending: 0,
  };
  for (const transaction of transactions) {
    if (
      typeof transaction.operationId !== "string"
      || !transaction.operationId.trim()
      || transaction.operationId.trim().length > 200
    ) {
      await CreditTransaction.updateOne(
        { _id: transaction._id, status: transaction.status },
        { $set: { status: "review_required", reason: "积分流水操作号无效" } },
        { runValidators: true },
      );
      result.reviewRequired += 1;
      continue;
    }
    if (transaction.status === "reserved") {
      const reviewed = await CreditTransaction.updateOne(
        {
          _id: transaction._id,
          status: "reserved",
          executionClaimId: transaction.executionClaimId,
          claimedAt: transaction.claimedAt,
        },
        { $set: { status: "review_required", reason: "执行进程中断，无法确认上游最终用量" } },
      );
      if (reviewed.modifiedCount === 1) result.reviewRequired += 1;
      continue;
    }
    if (transaction.type === "admin_set" && ["pending", "settling"].includes(transaction.status)) {
      try {
        const recovered = await adjustBalance({
          operationId: transaction.operationId,
          userId: transaction.userId,
          targetBalance: transaction.usage?.targetAvailableBalance,
          actorUserId: transaction.actorUserId,
          reason: transaction.reason,
        });
        if (recovered.status === "settled") result.settled += 1;
        else result.reviewRequired += 1;
      } catch (error) {
        if (!["CREDIT_ADMIN_ADJUSTMENT_CONFLICT", "CREDIT_ADMIN_ADJUSTMENT_NOT_APPLIED"].includes(error?.code)) {
          throw error;
        }
        result.reviewRequired += 1;
      }
      continue;
    }
    if (transaction.status === "pending") {
      if (transaction.type === "registration_grant") {
        const status = await reconcilePendingRegistrationGrant(transaction);
        if (status === "review_required") result.reviewRequired += 1;
        else result[status] += 1;
        continue;
      }
      const status = await reconcilePendingModelUsage(transaction);
      if (status === "review_required") result.reviewRequired += 1;
      else result[status] += 1;
      continue;
    }
    const settled = await settleCredits({
      operationId: transaction.operationId,
      chargedPoints: transaction.charged,
      ...(transaction.actualCostCny === null ? {} : { actualCostCny: transaction.actualCostCny }),
      ...(transaction.actualCostUsd === null ? {} : { actualCostUsd: transaction.actualCostUsd }),
      usage: transaction.usage,
      pricingSnapshot: transaction.pricingSnapshot,
      upstreamRequestIds: transaction.upstreamRequestIds,
    });
    if (settled.status === "settled") result.settled += 1;
    else if (settled.status === "released") result.released += 1;
    else if (settled.status === "review_required") result.reviewRequired += 1;
  }
  result.clearedSettlementReceipts = await cleanupTerminalSettlementReceipts(limit);
  result.anonymizedOrphans = await anonymizeOrphanedTransactions({ limit });
  return result;
}

export async function anonymizeUserTransactions(userId) {
  await dbConnect();
  assertObjectId(userId, "userId");
  let anonymizedTransactions = 0;
  while (true) {
    const owned = await CreditTransaction.find({ userId }).limit(100).lean();
    if (owned.length === 0) break;
    anonymizedTransactions += await anonymizeOwnedTransactions(owned);
  }
  const acted = await CreditTransaction.updateMany(
    { actorUserId: userId },
    { $set: { actorUserId: null } },
  );
  return {
    anonymizedTransactions,
    anonymizedActorReferences: acted.modifiedCount,
  };
}
