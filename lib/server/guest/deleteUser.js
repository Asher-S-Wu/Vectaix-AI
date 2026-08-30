import dbConnect from '@/lib/db';
import User from '@/models/User';
import Conversation from '@/models/Conversation';
import UserSettings from '@/models/UserSettings';
import VideoGenerationTask from '@/models/VideoGenerationTask';
import VideoEnhancementTask from '@/models/VideoEnhancementTask';
import MediaKitUploadTicket from '@/models/MediaKitUploadTicket';
import AudioGeneration from '@/models/AudioGeneration';
import CustomVoice from '@/models/CustomVoice';
import MinimaxAudioGeneration from '@/models/MinimaxAudioGeneration';
import MinimaxVoice from '@/models/MinimaxVoice';
import DoubaoAudioGeneration from '@/models/DoubaoAudioGeneration';
import DoubaoVoice from '@/models/DoubaoVoice';
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

export async function deleteUserAndData(id) {
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
            .select('_id profileId voiceId prefix status displayName lastRequestId +remoteCreateUncertain +remoteUpdateUncertain')
            .lean();
        const uncertainVoice = customVoices.find(
            (voice) => voice.remoteCreateUncertain && !voice.voiceId,
        );
        if (uncertainVoice) {
            // 尚未删除任何资料；释放账号围栏以便管理员核对，游客链接由管理接口继续保持停用。
            await cancelUserDeletionFence(deletionLease);
            deletionLease = null;
            const error = new UserOperationLeaseError(
                'VOICE_RECONCILIATION_REQUIRED',
                `音色“${uncertainVoice.displayName}”的云端创建结果未知，且没有音色编号。请管理员到阿里云按前缀“${uncertainVoice.prefix}”核对创建请求；完成核对并处理本地记录后才能继续删除，直接重试无法解决。`,
                409,
            );
            error.reconciliation = {
                userId: userId.toString(),
                profileId: uncertainVoice.profileId,
                prefix: uncertainVoice.prefix,
                requestId: uncertainVoice.lastRequestId,
            };
            throw error;
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

                // 更新结果不确定不会改变已知 voiceId；直接按该 ID 删除，不能要求被封住的账号先查询音色。
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
                            remoteUpdateStartedAt: 1,
                            remoteUpdateBackup: 1,
                        },
                        $set: {
                            status: 'UNDEPLOYED',
                            lastRequestId: requestId,
                            remoteCreateUncertain: false,
                            remoteUpdateUncertain: false,
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
            MinimaxAudioGeneration.deleteMany({ userId }),
            MinimaxVoice.deleteMany({ userId }),
            DoubaoAudioGeneration.deleteMany({ userId }),
            DoubaoVoice.deleteMany({ userId }),
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
        return { success: true };
    } catch (error) {
        if (deletionLease) {
            try {
                await releaseUserDeletionCleanupLease(deletionLease);
            } catch (releaseError) {
                console.error('[UserDelete] 释放清理租约失败', {
                    errorType: releaseError?.name,
                    code: releaseError?.code,
                });
            }
        }
        throw error;
    }
}
