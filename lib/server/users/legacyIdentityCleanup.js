import dbConnect from "@/lib/db";
import mongoose from "mongoose";
import { deleteUserAndData } from "@/lib/server/users/deleteUser";

const VIDEO_TERMINAL_STATUSES = ["completed", "failed", "canceled"];
const MEDIAKIT_TERMINAL_STATUSES = ["completed", "failed", "canceled"];

async function collectionExists(name) {
  const collections = await mongoose.connection.db
    .listCollections({ name }, { nameOnly: true })
    .toArray();
  return collections.length > 0;
}

async function dropCollectionIfPresent(database, name) {
  if (!await collectionExists(name)) return false;
  try {
    await database.collection(name).drop();
    return true;
  } catch (error) {
    if (error?.code === 26 || error?.codeName === "NamespaceNotFound") return false;
    throw error;
  }
}

function invalidFormalIdentityClauses() {
  return [
    { email: { $regex: /^\s*$/ } },
    { password: { $regex: /^\s*$/ } },
    {
      $expr: {
        $or: [
          { $ne: [{ $type: "$email" }, "string"] },
          { $ne: [{ $type: "$password" }, "string"] },
        ],
      },
    },
  ];
}

function toObjectIds(values) {
  return Array.from(new Set(
    values
      .filter((value) => mongoose.isValidObjectId(value))
      .map((value) => String(value)),
  )).map((value) => new mongoose.Types.ObjectId(value));
}

async function loadLegacyIdentityState(database) {
  const users = database.collection("users");
  const sessions = database.collection("sessions");
  const hasGuestLinks = await collectionExists("guestlinks");
  const [guestLinkOwners, guestSessionOwners] = await Promise.all([
    hasGuestLinks
      ? database.collection("guestlinks")
        .find({}, { projection: { userId: 1 } })
        .toArray()
      : [],
    sessions
      .find({ guestLinkId: { $exists: true } }, { projection: { userId: 1 } })
      .toArray(),
  ]);
  const linkedUserIds = toObjectIds(
    [...guestLinkOwners, ...guestSessionOwners].map((item) => item?.userId),
  );
  const legacyUsers = await users
    .find({
      $or: [
        { guestLinkId: { $exists: true } },
        ...(linkedUserIds.length ? [{ _id: { $in: linkedUserIds } }] : []),
        ...invalidFormalIdentityClauses(),
      ],
    }, { projection: { _id: 1 } })
    .toArray();
  return { hasGuestLinks, legacyUsers, users, sessions };
}

async function revokeLegacySessions(sessions, userIds) {
  const clauses = [{ guestLinkId: { $exists: true } }];
  if (userIds.length > 0) clauses.push({ userId: { $in: userIds } });
  const result = await sessions.deleteMany({ $or: clauses });
  return result.deletedCount || 0;
}

async function findActiveLegacyUserIds(database, userIds) {
  if (userIds.length === 0) return new Set();
  const activeFilter = {
    userId: { $in: userIds },
    $or: [
      { status: { $nin: VIDEO_TERMINAL_STATUSES } },
      { "billing.status": { $in: ["reserved", "settling"] } },
    ],
  };
  const [videoUsers, enhancementUsers] = await Promise.all([
    database.collection("videogenerationtasks").distinct("userId", activeFilter),
    database.collection("videoenhancementtasks").distinct("userId", {
      ...activeFilter,
      $or: [
        { status: { $nin: MEDIAKIT_TERMINAL_STATUSES } },
        { "billing.status": { $in: ["reserved", "settling"] } },
      ],
    }),
  ]);
  return new Set([...videoUsers, ...enhancementUsers].map((value) => String(value)));
}

export async function removeLegacyGuestData() {
  await dbConnect();
  const database = mongoose.connection.db;
  const initial = await loadLegacyIdentityState(database);
  const initialUserIds = initial.legacyUsers.map((user) => user._id);

  // 无论历史任务是否结束，都先撤销旧游客会话；新路由已移除，不再提供游客功能。
  let revokedSessions = await revokeLegacySessions(initial.sessions, initialUserIds);
  const activeUserIds = await findActiveLegacyUserIds(database, initialUserIds);
  let removedUsers = 0;
  let deferredUsers = 0;
  const deferredErrorCodes = new Set();

  for (const legacyUser of initial.legacyUsers) {
    if (activeUserIds.has(String(legacyUser._id))) {
      deferredUsers += 1;
      continue;
    }
    try {
      await deleteUserAndData(legacyUser._id);
      removedUsers += 1;
    } catch (error) {
      if (error?.code === "USER_NOT_FOUND") continue;
      deferredUsers += 1;
      deferredErrorCodes.add(
        /^[A-Z][A-Z0-9_]{0,63}$/.test(error?.code || "")
          ? error.code
          : "LEGACY_IDENTITY_DELETE_FAILED",
      );
    }
  }

  const remaining = await loadLegacyIdentityState(database);
  const remainingUserIds = remaining.legacyUsers.map((user) => user._id);
  revokedSessions += await revokeLegacySessions(remaining.sessions, remainingUserIds);
  if (remainingUserIds.length > 0) {
    const remainingActiveUserIds = await findActiveLegacyUserIds(database, remainingUserIds);
    return {
      complete: false,
      removedUsers,
      pendingUsers: remainingUserIds.length,
      activeUsers: remainingActiveUserIds.size,
      deferredUsers,
      deferredErrorCodes: [...deferredErrorCodes],
      revokedSessions,
    };
  }

  if (remaining.hasGuestLinks) await dropCollectionIfPresent(database, "guestlinks");

  const [remainingUsers, remainingSessions, invalidFormalUsers, remainingGuestLinks] = await Promise.all([
    remaining.users.countDocuments({ guestLinkId: { $exists: true } }),
    remaining.sessions.countDocuments({ guestLinkId: { $exists: true } }),
    remaining.users.countDocuments({
      $or: invalidFormalIdentityClauses(),
    }),
    collectionExists("guestlinks"),
  ]);
  if (remainingUsers > 0 || remainingSessions > 0 || invalidFormalUsers > 0 || remainingGuestLinks) {
    throw Object.assign(new Error("旧访问空间身份数据清理校验失败"), {
      name: "LegacyIdentityMigrationError",
      code: "LEGACY_IDENTITY_CLEANUP_INCOMPLETE",
    });
  }

  return {
    complete: true,
    removedUsers,
    pendingUsers: 0,
    activeUsers: 0,
    deferredUsers: 0,
    deferredErrorCodes: [],
    revokedSessions,
  };
}
