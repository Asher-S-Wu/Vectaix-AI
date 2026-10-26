import WorkspaceProject from '@/models/WorkspaceProject';
import WorkspaceDocument from '@/models/WorkspaceDocument';
import StoredFile from '@/models/StoredFile';
import WorkbenchTask from '@/models/WorkbenchTask';
import WorkbenchTaskEvent from '@/models/WorkbenchTaskEvent';
import Conversation from '@/models/Conversation';
import { deleteStoredFilesByOwner } from '@/lib/server/storage/service';
import { assertStoredFilesUnreferenced } from '@/lib/server/storage/references';
import { withProjectLock } from './projectLock';
import { requireObjectId, workbenchError } from './apiHelpers';
export { listEnabledSkills } from '@/lib/server/skills/service';

export async function requireProject(userId, projectId) {
  requireObjectId(projectId);
  const project = await WorkspaceProject.findOne({ _id: projectId, userId });
  if (!project) throw workbenchError('项目不存在', 404);
  return project;
}

export async function deleteProjectForUser(userId, id) {
  return withProjectLock(userId, 'task-creation', () => withProjectLock(userId, id, async () => {
    const project = await requireProject(userId, id);
    const projectId = project._id;
    if (await WorkbenchTask.exists({ userId, projectId, status: { $in: ['queued', 'running', 'waiting_media', 'waiting_approval'] } })) {
      throw workbenchError('项目仍有进行中的任务，请先停止任务', 409);
    }
    const tasks = await WorkbenchTask.find({ userId, projectId, conversationId: null }).select('_id').lean();
    const taskIds = tasks.map(task => task._id);
    const files = await StoredFile.find({ userId, $or: [{ ownerType: 'project', ownerId: String(projectId) }, { ownerType: 'task', ownerId: { $in: taskIds.map(String) } }] }).lean();
    await assertStoredFilesUnreferenced(userId, files, { excludeTaskIds: taskIds });
    await deleteStoredFilesByOwner({ userId, ownerType: 'project', ownerId: String(projectId) });
    for (const task of tasks) await deleteStoredFilesByOwner({ userId, ownerType: 'task', ownerId: String(task._id) });
    await WorkbenchTaskEvent.deleteMany({ userId, taskId: { $in: taskIds } });
    await WorkbenchTask.deleteMany({ userId, _id: { $in: taskIds } });
    await WorkbenchTask.updateMany({ userId, projectId }, { $set: { projectId: null } });
    await WorkspaceDocument.updateMany({ userId, projectId }, { $set: { projectId: null } });
    await Conversation.updateMany({ userId, projectId }, { $set: { projectId: null } });
    await WorkspaceProject.deleteOne({ _id: projectId, userId });
    return { success: true };
  }));
}
