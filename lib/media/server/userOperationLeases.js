import crypto from "node:crypto";
import mongoose from "mongoose";
import dbConnect from "@/lib/db";
import User from "@/models/User";

const MEDIA_WRITE_LEASE_TTL_MS = 5 * 60 * 1000;
const MEDIA_WRITE_HEARTBEAT_MS = 30 * 1000;
const VOICE_CREATION_LEASE_TTL_MS = 5 * 60 * 1000;
const VOICE_CREATION_HEARTBEAT_MS = 30 * 1000;
const USER_DELETION_LEASE_TTL_MS = 30 * 60 * 1000;
const USER_DELETION_HEARTBEAT_MS = 30 * 1000;
const DEFAULT_DRAIN_TIMEOUT_MS = 45 * 1000;
const DRAIN_POLL_INTERVAL_MS = 500;

const heartbeatTimerSymbol = Symbol("heartbeatTimer");

export class UserOperationLeaseError extends Error {
    constructor(code, message, statusCode = 409) {
        super(message);
        this.name = "UserOperationLeaseError";
        this.code = code;
        this.statusCode = statusCode;
        this.status = statusCode;
    }
}

function assertUserId(userId) {
    if (!mongoose.isValidObjectId(userId)) {
        throw new UserOperationLeaseError(
            "INVALID_USER_ID",
            "无效的用户 ID",
            400,
        );
    }
}

function createLease(userId, leaseId, expiresAt, timer) {
    const lease = {
        userId: userId.toString(),
        leaseId,
        expiresAt,
    };
    Object.defineProperty(lease, heartbeatTimerSymbol, {
        configurable: false,
        enumerable: false,
        value: timer,
        writable: false,
    });
    return lease;
}

function clearLeaseHeartbeat(lease) {
    const timer = lease?.[heartbeatTimerSymbol];
    if (timer) {
        clearInterval(timer);
    }
}

function startHeartbeat({ intervalMs, renew, logLabel }) {
    const timer = setInterval(() => {
        renew().catch((error) => {
            console.error(logLabel, {
                errorType: error?.name || "Error",
                code: error?.code || "",
            });
        });
    }, intervalMs);
    timer.unref?.();
    return timer;
}

async function readUserLeaseState(userId) {
    return User.findById(userId)
        .select("_id deletionInProgress")
        .lean();
}

function throwUnavailableUser(state) {
    if (!state) {
        throw new UserOperationLeaseError(
            "USER_NOT_FOUND",
            "用户不存在",
            404,
        );
    }
    if (state.deletionInProgress === true) {
        throw new UserOperationLeaseError(
            "USER_DELETING",
            "账号正在删除，暂时无法执行此操作",
            409,
        );
    }
}

/**
 * 原子登记一个媒体写操作。删除围栏一旦建立，新的登记会立即失败。
 * 调用方必须在 finally 中把返回值传给 endMediaWriteLease。
 */
export async function beginMediaWriteLease(userId) {
    assertUserId(userId);
    await dbConnect();

    const now = new Date();
    const leaseId = crypto.randomBytes(16).toString("hex");
    let expiresAt = new Date(now.getTime() + MEDIA_WRITE_LEASE_TTL_MS);

    await User.updateOne(
        { _id: userId },
        {
            $pull: {
                mediaWriteLeases: {
                    expiresAt: { $lte: now },
                },
            },
        },
    );

    const result = await User.updateOne(
        {
            _id: userId,
            deletionInProgress: { $ne: true },
        },
        {
            $push: {
                mediaWriteLeases: {
                    leaseId,
                    expiresAt,
                },
            },
        },
    );

    if (result.modifiedCount !== 1) {
        const state = await readUserLeaseState(userId);
        throwUnavailableUser(state);
        throw new UserOperationLeaseError(
            "MEDIA_WRITE_BLOCKED",
            "暂时无法开始媒体操作",
            409,
        );
    }

    const renew = async () => {
        const nextExpiresAt = new Date(Date.now() + MEDIA_WRITE_LEASE_TTL_MS);
        const renewed = await User.updateOne(
            {
                _id: userId,
                "mediaWriteLeases.leaseId": leaseId,
            },
            {
                $set: {
                    "mediaWriteLeases.$.expiresAt": nextExpiresAt,
                },
            },
        );
        if (renewed.matchedCount === 1) {
            expiresAt = nextExpiresAt;
        }
    };

    const timer = startHeartbeat({
        intervalMs: MEDIA_WRITE_HEARTBEAT_MS,
        renew,
        logLabel: "[MediaWriteLease] 续租失败",
    });
    return createLease(userId, leaseId, expiresAt, timer);
}

/**
 * 结束 beginMediaWriteLease 登记的媒体写操作。
 */
export async function endMediaWriteLease(lease) {
    clearLeaseHeartbeat(lease);
    if (!lease?.userId || !lease?.leaseId) {
        throw new UserOperationLeaseError(
            "INVALID_MEDIA_WRITE_LEASE",
            "媒体操作租约无效",
            400,
        );
    }

    await dbConnect();
    await User.updateOne(
        { _id: lease.userId },
        {
            $pull: {
                mediaWriteLeases: {
                    leaseId: lease.leaseId,
                },
            },
        },
    );
}

export async function assertMediaWriteLeaseActive(lease) {
    if (!lease?.userId || !lease?.leaseId) {
        throw new UserOperationLeaseError(
            "INVALID_MEDIA_WRITE_LEASE",
            "媒体操作租约无效",
            400,
        );
    }

    await dbConnect();
    const active = await User.exists({
        _id: lease.userId,
        mediaWriteLeases: {
            $elemMatch: {
                leaseId: lease.leaseId,
                expiresAt: { $gt: new Date() },
            },
        },
    });
    if (!active) {
        throw new UserOperationLeaseError(
            "MEDIA_WRITE_LEASE_LOST",
            "媒体操作已失效，未保存本次结果",
            409,
        );
    }
}

/**
 * 获取“创建复刻音色”单用户短租约。已有创建进行中时立即返回 409，不等待。
 * 调用方应先获取媒体写租约，再获取本租约，并在 finally 中释放两者。
 */
export async function acquireVoiceCreationLease(userId) {
    assertUserId(userId);
    await dbConnect();

    const now = new Date();
    const leaseId = crypto.randomBytes(16).toString("hex");
    let expiresAt = new Date(now.getTime() + VOICE_CREATION_LEASE_TTL_MS);

    const user = await User.findOneAndUpdate(
        {
            _id: userId,
            deletionInProgress: { $ne: true },
            $or: [
                { voiceCreationLeaseId: { $exists: false } },
                { voiceCreationLeaseId: null },
                { voiceCreationLeaseExpiresAt: { $exists: false } },
                { voiceCreationLeaseExpiresAt: null },
                { voiceCreationLeaseExpiresAt: { $lte: now } },
            ],
        },
        {
            $set: {
                voiceCreationLeaseId: leaseId,
                voiceCreationLeaseExpiresAt: expiresAt,
            },
        },
        { new: true },
    ).select("_id");

    if (!user) {
        const state = await readUserLeaseState(userId);
        throwUnavailableUser(state);
        throw new UserOperationLeaseError(
            "VOICE_CREATION_BUSY",
            "已有一个声音复刻正在创建，请等待完成后再试",
            409,
        );
    }

    const renew = async () => {
        const nextExpiresAt = new Date(Date.now() + VOICE_CREATION_LEASE_TTL_MS);
        const renewed = await User.updateOne(
            {
                _id: userId,
                voiceCreationLeaseId: leaseId,
            },
            {
                $set: {
                    voiceCreationLeaseExpiresAt: nextExpiresAt,
                },
            },
        );
        if (renewed.matchedCount === 1) {
            expiresAt = nextExpiresAt;
        }
    };

    const timer = startHeartbeat({
        intervalMs: VOICE_CREATION_HEARTBEAT_MS,
        renew,
        logLabel: "[VoiceCreationLease] 续租失败",
    });
    return createLease(userId, leaseId, expiresAt, timer);
}

/**
 * 释放 acquireVoiceCreationLease 获取的复刻创建短租约。
 */
export async function releaseVoiceCreationLease(lease) {
    clearLeaseHeartbeat(lease);
    if (!lease?.userId || !lease?.leaseId) {
        throw new UserOperationLeaseError(
            "INVALID_VOICE_CREATION_LEASE",
            "声音复刻创建租约无效",
            400,
        );
    }

    await dbConnect();
    await User.updateOne(
        {
            _id: lease.userId,
            voiceCreationLeaseId: lease.leaseId,
        },
        {
            $unset: {
                voiceCreationLeaseId: 1,
                voiceCreationLeaseExpiresAt: 1,
            },
        },
    );
}

/**
 * 原子建立用户删除围栏并取得本次清理租约。
 * 已进入删除状态但没有活动清理者时，可由后续管理员请求继续清理。
 */
export async function acquireUserDeletionFence(userId) {
    assertUserId(userId);
    await dbConnect();

    const now = new Date();
    const leaseId = crypto.randomBytes(16).toString("hex");
    let expiresAt = new Date(now.getTime() + USER_DELETION_LEASE_TTL_MS);
    const update = {
        $set: {
            deletionInProgress: true,
            deletionCleanupLeaseId: leaseId,
            deletionCleanupLeaseExpiresAt: expiresAt,
        },
        $pull: {
            mediaWriteLeases: {
                expiresAt: { $lte: now },
            },
        },
    };

    let user = await User.findOneAndUpdate(
        {
            _id: userId,
            deletionInProgress: { $ne: true },
        },
        {
            ...update,
            $set: {
                ...update.$set,
                deletionStartedAt: now,
            },
        },
        { new: true },
    ).select("_id email deletionInProgress");

    if (!user) {
        user = await User.findOneAndUpdate(
            {
                _id: userId,
                deletionInProgress: true,
                $or: [
                    { deletionCleanupLeaseId: { $exists: false } },
                    { deletionCleanupLeaseId: null },
                    { deletionCleanupLeaseExpiresAt: { $exists: false } },
                    { deletionCleanupLeaseExpiresAt: null },
                    { deletionCleanupLeaseExpiresAt: { $lte: now } },
                ],
            },
            update,
            { new: true },
        ).select("_id email deletionInProgress");
    }

    if (!user) {
        const state = await readUserLeaseState(userId);
        if (!state) {
            throw new UserOperationLeaseError(
                "USER_NOT_FOUND",
                "用户不存在",
                404,
            );
        }
        throw new UserOperationLeaseError(
            "USER_DELETION_BUSY",
            "该用户正在被删除，请稍后再试",
            409,
        );
    }

    const renew = async () => {
        const nextExpiresAt = new Date(Date.now() + USER_DELETION_LEASE_TTL_MS);
        const renewed = await User.updateOne(
            {
                _id: userId,
                deletionInProgress: true,
                deletionCleanupLeaseId: leaseId,
            },
            {
                $set: {
                    deletionCleanupLeaseExpiresAt: nextExpiresAt,
                },
            },
        );
        if (renewed.matchedCount === 1) {
            expiresAt = nextExpiresAt;
        }
    };

    const timer = startHeartbeat({
        intervalMs: USER_DELETION_HEARTBEAT_MS,
        renew,
        logLabel: "[UserDeletionFence] 续租失败",
    });
    return {
        lease: createLease(userId, leaseId, expiresAt, timer),
        user,
    };
}

/**
 * 等待删除围栏建立前已经登记的媒体写操作结束。
 */
export async function waitForMediaWriteLeasesToDrain(
    lease,
    { timeoutMs = DEFAULT_DRAIN_TIMEOUT_MS } = {},
) {
    if (!lease?.userId || !lease?.leaseId) {
        throw new UserOperationLeaseError(
            "INVALID_USER_DELETION_LEASE",
            "用户删除租约无效",
            400,
        );
    }

    const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
    await dbConnect();

    while (true) {
        const now = new Date();
        const user = await User.findOneAndUpdate(
            {
                _id: lease.userId,
                deletionInProgress: true,
                deletionCleanupLeaseId: lease.leaseId,
                deletionCleanupLeaseExpiresAt: { $gt: now },
            },
            {
                $pull: {
                    mediaWriteLeases: {
                        expiresAt: { $lte: now },
                    },
                },
            },
            { new: true },
        )
            .select("mediaWriteLeases voiceCreationLeaseId voiceCreationLeaseExpiresAt")
            .lean();

        if (!user) {
            throw new UserOperationLeaseError(
                "USER_DELETION_LEASE_LOST",
                "用户删除任务已由其他请求接管",
                409,
            );
        }

        const activeMediaWrites = (user.mediaWriteLeases || []).some(
            (item) => item?.expiresAt && new Date(item.expiresAt).getTime() > now.getTime(),
        );
        const activeVoiceCreation = Boolean(
            user.voiceCreationLeaseId
            && user.voiceCreationLeaseExpiresAt
            && new Date(user.voiceCreationLeaseExpiresAt).getTime() > now.getTime(),
        );

        if (!activeMediaWrites && !activeVoiceCreation) {
            return;
        }
        if (Date.now() >= deadline) {
            throw new UserOperationLeaseError(
                "MEDIA_WRITES_NOT_DRAINED",
                "仍有媒体操作正在完成，账号已保持删除中，请稍后重试删除",
                409,
            );
        }

        await new Promise((resolve) => setTimeout(resolve, DRAIN_POLL_INTERVAL_MS));
    }
}

export async function assertUserDeletionFenceActive(lease) {
    if (!lease?.userId || !lease?.leaseId) {
        throw new UserOperationLeaseError(
            "INVALID_USER_DELETION_LEASE",
            "用户删除租约无效",
            400,
        );
    }

    await dbConnect();
    const active = await User.exists({
        _id: lease.userId,
        deletionInProgress: true,
        deletionCleanupLeaseId: lease.leaseId,
        deletionCleanupLeaseExpiresAt: { $gt: new Date() },
    });
    if (!active) {
        throw new UserOperationLeaseError(
            "USER_DELETION_LEASE_LOST",
            "用户删除任务已由其他请求接管",
            409,
        );
    }
}

/**
 * 仅在尚未开始清理用户数据时撤销删除围栏，例如等待云端音色对账。
 */
export async function cancelUserDeletionFence(lease) {
    clearLeaseHeartbeat(lease);
    if (!lease?.userId || !lease?.leaseId) {
        throw new UserOperationLeaseError(
            "INVALID_USER_DELETION_LEASE",
            "用户删除租约无效",
            400,
        );
    }

    await dbConnect();
    const cancelled = await User.updateOne(
        {
            _id: lease.userId,
            deletionInProgress: true,
            deletionCleanupLeaseId: lease.leaseId,
        },
        {
            $set: {
                deletionInProgress: false,
            },
            $unset: {
                deletionStartedAt: 1,
                deletionCleanupLeaseId: 1,
                deletionCleanupLeaseExpiresAt: 1,
            },
        },
    );
    if (cancelled.matchedCount !== 1) {
        throw new UserOperationLeaseError(
            "USER_DELETION_LEASE_LOST",
            "用户删除任务已由其他请求接管",
            409,
        );
    }
}

/**
 * 放弃本次清理所有权，但不会撤销 deletionInProgress 删除围栏。
 */
export async function releaseUserDeletionCleanupLease(lease) {
    clearLeaseHeartbeat(lease);
    if (!lease?.userId || !lease?.leaseId) {
        return;
    }

    await dbConnect();
    await User.updateOne(
        {
            _id: lease.userId,
            deletionInProgress: true,
            deletionCleanupLeaseId: lease.leaseId,
        },
        {
            $unset: {
                deletionCleanupLeaseId: 1,
                deletionCleanupLeaseExpiresAt: 1,
            },
        },
    );
}

/**
 * 用户记录已经删除时，仅停止本进程的续租定时器。
 */
export function completeUserDeletionFence(lease) {
    clearLeaseHeartbeat(lease);
}
