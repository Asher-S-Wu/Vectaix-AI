import FileFolder from '@/models/FileFolder';
import Passkey from '@/models/Passkey';
import AuthChallenge from '@/models/AuthChallenge';
import UserConnection from '@/models/UserConnection';
import TaskApproval from '@/models/TaskApproval';
import BackupJob from '@/models/BackupJob';
import { closeBrowser } from '@/lib/server/browser/service';
import { deleteUserBackups } from '@/lib/server/backups/service';
import WorkspaceProject from '@/models/WorkspaceProject';
import WorkspaceDocument from '@/models/WorkspaceDocument';
import WorkbenchTask from '@/models/WorkbenchTask';
import WorkbenchTaskEvent from '@/models/WorkbenchTaskEvent';
import dbConnect from '@/lib/db';
import User from '@/models/User';
import Conversation from '@/models/Conversation';
import UserSettings from '@/models/UserSettings';
import FishAudioGeneration from '@/models/FishAudioGeneration';
import FishVoice from '@/models/FishVoice';
import QwenVoice from '@/models/QwenVoice';
import QwenAudioGeneration from '@/models/QwenAudioGeneration';
import { deleteQwenVoice } from '@/lib/media/server/qwenAudio';
import { clearSharedVoice } from '@/lib/server/media/settings';
import {
    deleteAllStoredFilesForUser,
} from '@/lib/server/storage/service';
import { deleteAllAuthSessionsForUser } from '@/lib/auth';
import { deleteFishVoice } from '@/lib/media/server/fishAudio';
import {
    acquireUserDeletionFence,
    assertUserDeletionFenceActive,
    cancelUserDeletionFence,
    completeUserDeletionFence,
    releaseUserDeletionCleanupLease,
    UserOperationLeaseError,
    waitForMediaWriteLeasesToDrain,
} from '@/lib/media/server/userOperationLeases';
import { closeUserCostsForDeletion } from '@/lib/server/credits/deletion';
import { anonymizeUserTransactions } from '@/lib/server/credits/service';
import { CreditError } from '@/lib/server/credits/errors';
import { ACTIVE_TASK_STATUSES } from '@/lib/server/workbench/config';

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

        if (await WorkbenchTask.exists({ userId, status: { $in: ACTIVE_TASK_STATUSES } })) {
            await cancelUserDeletionFence(deletionLease);
            deletionLease = null;
            throw new CreditError('该用户仍有工作台任务，请等待任务结束后再删除', { code: 'USER_ACTIVE_WORKBENCH_TASKS', statusCode: 409 });
        }
        if (await BackupJob.exists({ userId, status: 'running' })) {
            await cancelUserDeletionFence(deletionLease);
            deletionLease = null;
            throw new CreditError('该用户仍有备份或恢复任务，请等待任务完成后再删除', { code: 'USER_ACTIVE_BACKUP', statusCode: 409 });
        }
        await closeUserCostsForDeletion(userId);

        for (const [Voice, deleteVoice] of [[FishVoice, deleteFishVoice], [QwenVoice, deleteQwenVoice]]) {
          const voices = await Voice.find({ userId }).lean();
          for (const voice of voices) {
            await assertUserDeletionFenceActive(deletionLease);
            try {
                await deleteVoice(voice.voiceId);
            } catch (error) {
                if (error.status !== 404) throw error;
            }
            await assertUserDeletionFenceActive(deletionLease);
            await clearSharedVoice(voice.voiceId);
            await Voice.deleteOne({ _id: voice._id, userId });
          }
        }

        // 必须先清理挂载硬盘；失败时保留用户与删除围栏，避免产生失联文件。
        await assertUserDeletionFenceActive(deletionLease);
        await closeBrowser(String(userId), { revoke: true });
        await deleteUserBackups(userId);
        await deleteAllStoredFilesForUser(userId);

        // 用户记录最后删除；任何中途失败都保留“删除中”状态并阻止新写入。
        await Promise.all([
            deleteAllAuthSessionsForUser(userId),
            Conversation.deleteMany({ userId }),
            WorkspaceProject.deleteMany({ userId }),
            FileFolder.deleteMany({ userId }),
            Passkey.deleteMany({ userId }),
            AuthChallenge.deleteMany({ userId }),
            UserConnection.deleteMany({ userId }),
            TaskApproval.deleteMany({ userId }),
            WorkspaceDocument.deleteMany({ userId }),
            WorkbenchTask.deleteMany({ userId }),
            WorkbenchTaskEvent.deleteMany({ userId }),
            UserSettings.deleteMany({ userId }),
            FishAudioGeneration.deleteMany({ userId }),
            FishVoice.deleteMany({ userId }),
            QwenAudioGeneration.deleteMany({ userId }),
            QwenVoice.deleteMany({ userId }),
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

        // 先确认账号记录已经成功删除，再解除流水关联。这样即使删除租约失效，
        // 仍然存在的会员也不会提前失去自己的花费历史。
        await anonymizeUserTransactions(userId);
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
