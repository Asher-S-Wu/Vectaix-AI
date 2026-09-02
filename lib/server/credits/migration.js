import dbConnect from "@/lib/db";
import mongoose from "mongoose";
import BillingSettings, { ensureBillingSettingsIndexes } from "@/models/BillingSettings";
import CreditTransaction, { ensureCreditTransactionIndexes } from "@/models/CreditTransaction";
import User from "@/models/User";
import { getOrCreateCreditAuditKey } from "./service";
import { getBillingSettings } from "./settings";
import { BILLING_SETTINGS_KEY, DEFAULT_BILLING_SETTINGS } from "./constants";

const BILLING_CHAT_RATE_UPGRADES = [
  {
    modelId: "gpt-5.6-sol",
    fields: [
      "cachedInputPerMillion",
      "cacheWritePerMillion",
      "longContextThreshold",
      "longInputMultiplier",
      "longOutputMultiplier",
    ],
  },
  {
    modelId: "qwen-3.8-max",
    fields: ["cachedInputPerMillion"],
  },
];

async function upgradeStoredBillingSettings() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existing = await BillingSettings.collection.findOne({ key: BILLING_SETTINGS_KEY });
    if (!existing) return false;
    const existingChat = existing.rates?.chat;
    if (!existingChat || typeof existingChat !== "object" || Array.isArray(existingChat)) {
      throw new Error("现有计费设置缺少聊天费率，无法执行价格字段升级");
    }
    const upgradedChat = structuredClone(existingChat);
    let changed = false;
    for (const { modelId, fields } of BILLING_CHAT_RATE_UPGRADES) {
      const storedRate = upgradedChat[modelId];
      const defaultRate = DEFAULT_BILLING_SETTINGS.rates.chat[modelId];
      if (!storedRate || typeof storedRate !== "object" || Array.isArray(storedRate)) {
        throw new Error(`现有计费设置缺少 ${modelId} 费率，无法执行价格字段升级`);
      }
      for (const field of fields) {
        if (Object.hasOwn(storedRate, field)) continue;
        storedRate[field] = defaultRate[field];
        changed = true;
      }
    }
    if (!changed) return false;
    if (!Number.isSafeInteger(existing.version) || existing.version < 1) {
      throw new Error("现有计费设置版本无效，无法执行价格字段升级");
    }
    const updated = await BillingSettings.collection.updateOne(
      { _id: existing._id, version: existing.version },
      {
        $set: {
          "rates.chat": upgradedChat,
          updatedAt: new Date(),
        },
        $inc: { version: 1 },
      },
    );
    if (updated.modifiedCount === 1) return true;
  }
  throw new Error("计费设置正在被频繁修改，价格字段升级未能完成");
}

function registrationOperationId(userId) {
  return `registration_grant:${userId}`;
}

function uninitializedFormalUserFilter() {
  return {
    creditsInitializedAt: { $exists: false },
    guestLinkId: { $exists: false },
    email: { $type: "string", $regex: /\S/ },
    password: { $type: "string", $regex: /\S/ },
  };
}

async function createPendingGrant(userId, initialCredits) {
  const operationId = registrationOperationId(userId);
  if (!Number.isSafeInteger(initialCredits) || initialCredits < 0) {
    throw new Error("注册初始积分必须是非负安全整数");
  }
  const auditUserKey = await getOrCreateCreditAuditKey(userId);
  try {
    return await CreditTransaction.create({
      operationId,
      userId,
      auditUserKey,
      actorUserId: null,
      type: "registration_grant",
      status: "pending",
      requested: 0,
      reserved: 0,
      charged: 0,
      refunded: 0,
      usage: { initialCredits },
      reason: "注册初始积分",
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    return CreditTransaction.findOne({ operationId });
  }
}

async function finalizeGrant(transaction, initialCredits, initializedAt) {
  if (!Number.isSafeInteger(initialCredits) || initialCredits < 0) {
    throw new Error("注册流水中的初始积分无效");
  }
  return CreditTransaction.updateOne(
    { _id: transaction._id, status: "pending" },
    {
      $set: {
        status: "settled",
        balanceBefore: 0,
        balanceAfter: initialCredits,
        usage: { initialCredits, initializedAt },
      },
    },
    { runValidators: true },
  );
}

export async function initializeUserCredits(userId, { settings: providedSettings } = {}) {
  await dbConnect();
  const settings = providedSettings || await getBillingSettings();
  const transaction = await createPendingGrant(userId, settings.initialCredits);
  if (
    transaction.type !== "registration_grant"
    || String(transaction.userId) !== String(userId)
  ) {
    throw new Error("注册积分 operationId 冲突");
  }
  const frozenInitialCredits = transaction.usage?.initialCredits;
  if (!Number.isSafeInteger(frozenInitialCredits) || frozenInitialCredits < 0) {
    throw new Error("注册流水中的初始积分无效");
  }
  const initializedAt = new Date();
  const user = await User.collection.findOneAndUpdate(
    {
      _id: new mongoose.Types.ObjectId(String(userId)),
      creditsInitializedAt: { $exists: false },
    },
    {
      $set: {
        creditBalance: frozenInitialCredits,
        creditHeld: 0,
        creditHolds: [],
        creditSettlementReceipts: [],
        creditVersion: 0,
        creditLastOperationId: transaction.operationId,
        creditInitializationOperationId: transaction.operationId,
        creditsInitializedAt: initializedAt,
      },
    },
    {
      returnDocument: "after",
      includeResultMetadata: false,
      projection: { creditsInitializedAt: 1, creditInitializationOperationId: 1 },
    },
  );
  if (user) {
    await finalizeGrant(transaction, frozenInitialCredits, user.creditsInitializedAt);
  }
  return {
    initialized: Boolean(user),
    transaction: await CreditTransaction.findById(transaction._id).lean(),
  };
}

export async function runCreditMigration() {
  await dbConnect();
  await ensureBillingSettingsIndexes();
  const upgradedBillingSettings = await upgradeStoredBillingSettings();
  const settings = await getBillingSettings();
  await ensureCreditTransactionIndexes();

  let initializedUsers = 0;
  // 旧游客可能因为运行中异步任务而暂时保留；补发只能遍历完整的正式会员身份。
  const users = User.collection.find(
    uninitializedFormalUserFilter(),
    { projection: { _id: 1 } },
  ).sort({ createdAt: 1, _id: 1 });

  for await (const user of users) {
    const result = await initializeUserCredits(user._id, { settings });
    if (result.initialized) initializedUsers += 1;
  }

  let recoveredGrants = 0;
  const pendingGrants = CreditTransaction.find({
    type: "registration_grant",
    status: "pending",
  }).cursor();
  for await (const transaction of pendingGrants) {
    const user = await User.findOne({
      _id: transaction.userId,
      creditsInitializedAt: { $exists: true },
    })
      .select("creditsInitializedAt creditInitializationOperationId")
      .lean();
    if (!user) continue;
    const initialCredits = transaction.usage?.initialCredits;
    if (!Number.isSafeInteger(initialCredits) || initialCredits < 0) {
      await CreditTransaction.updateOne(
        { _id: transaction._id, status: "pending" },
        { $set: { status: "review_required", reason: "注册流水中的初始积分无效" } },
      );
      continue;
    }
    if (
      user.creditInitializationOperationId !== transaction.operationId
    ) {
      await CreditTransaction.updateOne(
        { _id: transaction._id, status: "pending" },
        { $set: { status: "review_required", reason: "注册流水与用户钱包金额不一致" } },
      );
      continue;
    }
    await finalizeGrant(transaction, initialCredits, user.creditsInitializedAt);
    recoveredGrants += 1;
  }

  return {
    settingsVersion: settings.version,
    upgradedBillingSettings,
    initializedUsers,
    recoveredGrants,
    collections: {
      billingSettings: BillingSettings.collection.collectionName,
      creditTransactions: CreditTransaction.collection.collectionName,
    },
  };
}

export async function reconcileUninitializedUserCredits({ limit = 100 } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw new TypeError("未初始化用户对账数量必须是 1 到 1000 的整数");
  }
  await dbConnect();
  const settings = await getBillingSettings();
  const users = await User.collection.find(
    uninitializedFormalUserFilter(),
    { projection: { _id: 1 } },
  )
    .sort({ createdAt: 1, _id: 1 })
    .limit(limit)
    .toArray();
  let initializedUsers = 0;
  for (const user of users) {
    const result = await initializeUserCredits(user._id, { settings });
    if (result.initialized) initializedUsers += 1;
  }
  return { scanned: users.length, initializedUsers };
}
