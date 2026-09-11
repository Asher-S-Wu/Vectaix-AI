import crypto from "node:crypto";
import mongoose from "mongoose";

import dbConnect from "@/lib/db";
import CreditTransaction from "@/models/CreditTransaction";
import User from "@/models/User";
import { CreditError, invalidCreditArgument } from "./errors";

const TERMINAL_STATUSES = new Set(["settled", "released", "rejected"]);
const CLAIMED_EXECUTION_STALE_MS = 30 * 60 * 1000;

function assertObjectId(value, name) {
  if (!mongoose.isValidObjectId(value)) {
    throw invalidCreditArgument(`${name} 不是有效用户 ID`);
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
        { auditKey: { $exists: false } },
        { auditKey: null },
      ],
    },
    { $set: { auditKey: generated } },
    {
      returnDocument: "after",
      includeResultMetadata: false,
      projection: { auditKey: 1 },
    },
  );
  if (initialized?.auditKey) return initialized.auditKey;
  const existing = await User.collection.findOne(
    { _id: objectId },
    { projection: { auditKey: 1 } },
  );
  if (typeof existing?.auditKey !== "string" || !existing.auditKey) {
    throw new CreditError("用户不存在或审计标识初始化失败", {
      code: "CREDIT_USER_NOT_FOUND",
      statusCode: 404,
    });
  }
  return existing.auditKey;
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
    throw operationConflict("同一 operationId 的请求内容不一致");
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
    throw operationConflict("claimId 已被其他请求操作使用");
  }
  if (transaction) {
    return { claimed: true, alreadyProcessed: false, transaction: plain(transaction) };
  }

  const existing = await CreditTransaction.findOne({ operationId: normalizedOperationId });
  if (!existing) {
    throw new CreditError("花费记录不存在", {
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
    throw new CreditError("花费记录不存在", {
      code: "CREDIT_TRANSACTION_NOT_FOUND",
      statusCode: 404,
    });
  }
  throw operationConflict("请求执行 claim 已变化，不能移交给异步任务");
}

function assertSettlementReplay(transaction, {
  actualCostCny,
  actualCostUsd,
  usage,
  pricingSnapshot,
  upstreamRequestIds,
  actorUserId,
  reason,
}) {
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

export async function reserveCredits({
  operationId, userId, actorUserId = null, type = "model_usage", feature = "",
  provider = "", model = "", usage = null, pricingSnapshot = null,
  upstreamRequestIds = [], reason = "", executionClaimId = null,
} = {}) {
  await dbConnect();
  operationId = normalizeOperationId(operationId);
  assertObjectId(userId, "userId");
  if (actorUserId !== null) assertObjectId(actorUserId, "actorUserId");
  if (executionClaimId !== null) executionClaimId = normalizeClaimId(executionClaimId);
  upstreamRequestIds = normalizeStringArray(upstreamRequestIds, "upstreamRequestIds");
  const user = await User.findOne({ _id: userId, deletionInProgress: { $ne: true } }).select("_id").lean();
  if (!user) throw new CreditError("用户不存在", { code: "CREDIT_USER_NOT_FOUND", statusCode: 404 });
  const input = { userId, actorUserId, type, feature, provider, model, usage, pricingSnapshot, upstreamRequestIds, reason };
  const { transaction, created } = await createOperation({
    ...input, operationId, auditUserKey: await resolveAuditUserKey(userId),
    status: "reserved", reservationRequestHash: reservationRequestHash(input),
    ...(executionClaimId ? { executionClaimId, claimedAt: new Date() } : {}),
  });
  if (!created) {
    assertReservationReplay(transaction, input);
    if (executionClaimId && transaction.executionClaimId !== executionClaimId) {
      throw operationConflict("本次请求已提交，请勿重复提交");
    }
  }
  return plain(transaction);
}

async function finishOperation({ operationId, actualCostCny, actualCostUsd, usage, pricingSnapshot, upstreamRequestIds, actorUserId, reason }, status) {
  await dbConnect();
  operationId = normalizeOperationId(operationId);
  assertOptionalAmount(actualCostCny, "actualCostCny");
  assertOptionalAmount(actualCostUsd, "actualCostUsd");
  if (actorUserId != null) assertObjectId(actorUserId, "actorUserId");
  upstreamRequestIds = normalizeStringArray(upstreamRequestIds, "upstreamRequestIds");
  const values = { actualCostCny, actualCostUsd, usage, pricingSnapshot, upstreamRequestIds, actorUserId, reason };
  const updates = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
  const transaction = await CreditTransaction.findOneAndUpdate(
    { operationId, status: { $in: ["reserved", "review_required"] } },
    { $set: { ...updates, status } }, { new: true, runValidators: true },
  );
  if (transaction) return plain(transaction);
  const existing = await CreditTransaction.findOne({ operationId });
  if (!existing) throw new CreditError("花费记录不存在", { code: "CREDIT_TRANSACTION_NOT_FOUND", statusCode: 404 });
  if (existing.status !== status) throw operationConflict("本次请求已经结束，不能修改结果");
  assertSettlementReplay(existing, values);
  return plain(existing);
}

export async function settleCredits(input = {}) {
  if (!Number.isFinite(input.actualCostCny) || input.actualCostCny < 0) {
    throw invalidCreditArgument("实际人民币花费必须是非负有限数字");
  }
  return finishOperation(input, "settled");
}

export async function releaseCredits(operationId, details = {}) {
  return finishOperation({ ...details, operationId, actualCostCny: 0, actualCostUsd: 0 }, "released");
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
    throw new CreditError("花费记录不存在", {
      code: "CREDIT_TRANSACTION_NOT_FOUND",
      statusCode: 404,
    });
  }
  return plain(existing);
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
  const transactions = await CreditTransaction.find({
    status: "reserved", executionClaimId: { $type: "string", $ne: "" },
    claimedAt: { $lte: new Date(Date.now() - CLAIMED_EXECUTION_STALE_MS) },
  }).sort({ createdAt: 1 }).limit(limit).lean();
  let reviewRequired = 0;
  for (const transaction of transactions) {
    const result = await CreditTransaction.updateOne(
      { _id: transaction._id, status: "reserved", executionClaimId: transaction.executionClaimId, claimedAt: transaction.claimedAt },
      { $set: { status: "review_required", reason: "执行进程中断，无法确认最终用量" } },
    );
    reviewRequired += result.modifiedCount;
  }
  return { scanned: transactions.length, reviewRequired, anonymizedOrphans: await anonymizeOrphanedTransactions({ limit }) };
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
