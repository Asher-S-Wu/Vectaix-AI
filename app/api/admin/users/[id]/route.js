import dbConnect from '@/lib/db';
import { isAdminEmail, requireAdmin } from '@/lib/admin';
import User from '@/models/User';
import Conversation from '@/models/Conversation';
import UserSettings from '@/models/UserSettings';
import VideoGenerationTask from '@/models/VideoGenerationTask';
import VideoEnhancementTask from '@/models/VideoEnhancementTask';
import MediaKitUploadTicket from '@/models/MediaKitUploadTicket';
import AudioGeneration from '@/models/AudioGeneration';
import CustomVoice from '@/models/CustomVoice';
import DoubaoAudioGeneration from '@/models/DoubaoAudioGeneration';
import MinimaxAudioGeneration from '@/models/MinimaxAudioGeneration';
import MinimaxVoice from '@/models/MinimaxVoice';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { forbiddenResponse } from '@/lib/server/api/routeHelpers';
import {
    deleteAllStoredFilesForUser,
    deleteStoredFilesByOwner,
} from '@/lib/server/storage/service';
import { deleteAllAuthSessionsForUser } from '@/lib/auth';
import {
    deleteCustomVoice,
    isMissingCustomVoiceError,
} from '@/lib/media/server/qwenAudio';
import {
    deleteMinimaxVoice,
    isMissingMinimaxVoiceError,
} from '@/lib/media/server/minimaxAudio';
import {
    acquireUserDeletionFence,
    assertUserDeletionFenceActive,
    cancelUserDeletionFence,
    completeUserDeletionFence,
    releaseUserDeletionCleanupLease,
    UserOperationLeaseError,
    waitForMediaWriteLeasesToDrain,
} from '@/lib/media/server/userOperationLeases';

export const dynamic = 'force-dynamic';

async function parseJsonBody(req) {
    try {
        return await req.json();
    } catch {
        return null;
    }
}

// 重置用户密码
export async function PATCH(req, context) {
    const admin = await requireAdmin();
    if (!admin) {
        return forbiddenResponse();
    }

    const { id } = await context.params;
    if (!mongoose.isValidObjectId(id)) {
        return Response.json({ error: '无效的用户 ID' }, { status: 400 });
    }

    await dbConnect();

    const user = await User.findById(id);
    if (!user) {
        return Response.json({ error: '用户不存在' }, { status: 404 });
    }

    const body = await parseJsonBody(req);
    if (body?.action === 'set-advanced-user') {
        if (isAdminEmail(user.email)) {
            return Response.json({ error: '超级管理员不需要调整高级用户权限' }, { status: 400 });
        }

        const nextIsAdvancedUser = body?.isAdvancedUser === true;
        user.isAdvancedUser = nextIsAdvancedUser;
        await user.save();

        return Response.json({
            success: true,
            user: {
                id: user._id.toString(),
                email: user.email,
                isAdmin: false,
                isAdvancedUser: nextIsAdvancedUser,
            },
        });
    }

    // 生成随机密码（12 位，包含大小写字母和数字）
    const newPassword = crypto.randomBytes(9).toString('base64url').slice(0, 12);
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    await deleteAllAuthSessionsForUser(user._id);

    return Response.json({ success: true, newPassword });
}

// 删除用户及其所有数据
export async function DELETE(req, context) {
    const admin = await requireAdmin();
    if (!admin) {
        return forbiddenResponse();
    }

    const { id } = await context.params;
    if (!mongoose.isValidObjectId(id)) {
        return Response.json({ error: '无效的用户 ID' }, { status: 400 });
    }

    // 不能删除自己
    if (admin.userId === id) {
        return Response.json({ error: '不能删除自己的账号' }, { status: 400 });
    }

    await dbConnect();

    let deletionLease = null;
    try {
        // 先用原子更新封住所有新媒体写操作，再撤销该用户的全部会话。
        const acquired = await acquireUserDeletionFence(id);
        deletionLease = acquired.lease;
        const userId = acquired.user._id;

        await deleteAllAuthSessionsForUser(userId);
        await waitForMediaWriteLeasesToDrain(deletionLease);

        // 阿里云复刻音色占用账号级配额，必须先逐个释放，再删除本地用户数据。
        const customVoices = await CustomVoice.find({ userId })
            .select('_id profileId voiceId prefix status +remoteCreateUncertain +remoteUpdateUncertain')
            .lean();
        const uncertainVoice = customVoices.find(
            (voice) => (
                (voice.remoteCreateUncertain && !voice.voiceId)
                || voice.remoteUpdateUncertain
            ),
        );
        if (uncertainVoice) {
            await cancelUserDeletionFence(deletionLease);
            deletionLease = null;
            throw new UserOperationLeaseError(
                'VOICE_RECONCILIATION_REQUIRED',
                '该账号存在云端结果待核对的复刻音色，暂时不能删除用户',
                409,
            );
        }
        for (const voice of customVoices) {
            await assertUserDeletionFenceActive(deletionLease);
            if (voice.voiceId) {
                const intent = await CustomVoice.updateOne(
                    {
                        _id: voice._id,
                        userId,
                        voiceId: voice.voiceId,
                    },
                    {
                        $set: {
                            status: 'DELETING',
                            mutationId: deletionLease.leaseId,
                            mutationStartedAt: new Date(),
                        },
                    },
                );
                if (intent.matchedCount !== 1) {
                    throw new Error('无法登记复刻音色删除状态');
                }

                let requestId = '';
                try {
                    const upstream = await deleteCustomVoice(voice.voiceId);
                    requestId = upstream.requestId;
                } catch (error) {
                    if (!isMissingCustomVoiceError(error)) {
                        throw error;
                    }
                    requestId = error.requestId || '';
                }
                await assertUserDeletionFenceActive(deletionLease);
                await CustomVoice.updateOne(
                    { _id: voice._id, userId },
                    {
                        $unset: {
                            voiceId: 1,
                            mutationId: 1,
                            mutationStartedAt: 1,
                        },
                        $set: {
                            status: 'UNDEPLOYED',
                            lastRequestId: requestId,
                        },
                    },
                );
            }
            await deleteStoredFilesByOwner({
                userId,
                ownerType: 'voice-profile',
                ownerId: voice.profileId,
            });
            await CustomVoice.deleteOne({ _id: voice._id, userId });
        }

        const minimaxVoices = await MinimaxVoice.find({ userId }).lean();
        for (const voice of minimaxVoices) {
            await assertUserDeletionFenceActive(deletionLease);
            try {
                await deleteMinimaxVoice(voice.voiceId);
            } catch (error) {
                if (!isMissingMinimaxVoiceError(error)) {
                    throw error;
                }
            }
            await deleteStoredFilesByOwner({
                userId,
                ownerType: 'voice-profile',
                ownerId: voice.profileId,
            });
            await MinimaxVoice.deleteOne({ _id: voice._id, userId });
        }

        // 必须先清理挂载硬盘；失败时保留用户与删除围栏，避免产生失联文件。
        await assertUserDeletionFenceActive(deletionLease);
        await deleteAllStoredFilesForUser(userId);

        // 用户记录最后删除；任何中途失败都保留“删除中”状态并阻止新写入。
        await Promise.all([
            deleteAllAuthSessionsForUser(userId),
            Conversation.deleteMany({ userId }),
            UserSettings.deleteMany({ userId }),
            VideoGenerationTask.deleteMany({ userId }),
            VideoEnhancementTask.deleteMany({ userId }),
            MediaKitUploadTicket.deleteMany({ userId }),
            AudioGeneration.deleteMany({ userId }),
            CustomVoice.deleteMany({ userId }),
            DoubaoAudioGeneration.deleteMany({ userId }),
            MinimaxAudioGeneration.deleteMany({ userId }),
            MinimaxVoice.deleteMany({ userId }),
        ]);
        await assertUserDeletionFenceActive(deletionLease);
        const deleted = await User.deleteOne({
            _id: userId,
            deletionInProgress: true,
            deletionCleanupLeaseId: deletionLease.leaseId,
            deletionCleanupLeaseExpiresAt: { $gt: new Date() },
        });
        if (deleted.deletedCount !== 1) {
            throw new UserOperationLeaseError(
                'USER_DELETION_LEASE_LOST',
                '用户删除任务已由其他请求接管',
                409,
            );
        }

        completeUserDeletionFence(deletionLease);
        return Response.json({ success: true });
    } catch (error) {
        if (deletionLease) {
            try {
                await releaseUserDeletionCleanupLease(deletionLease);
            } catch (releaseError) {
                console.error('[AdminUserDelete] 释放清理租约失败', {
                    errorType: releaseError?.name || 'Error',
                    code: releaseError?.code || '',
                });
            }
        }

        console.error('[AdminUserDelete] 删除用户失败', {
            errorType: error?.name || 'Error',
            code: error?.code || '',
        });
        if (error instanceof UserOperationLeaseError) {
            return Response.json(
                { error: error.message },
                { status: error.statusCode },
            );
        }
        return Response.json(
            {
                error: deletionLease
                    ? '删除用户失败，账号已保持删除中状态，请稍后重试'
                    : '删除用户失败，请稍后重试',
            },
            { status: 500 },
        );
    }
}
