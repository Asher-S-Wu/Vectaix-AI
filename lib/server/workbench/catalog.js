import WorkspaceProject from '@/models/WorkspaceProject';
import { requireObjectId, workbenchError } from './apiHelpers';
export { listEnabledSkills } from '@/lib/server/skills/service';

export async function requireProject(userId, projectId) {
  requireObjectId(projectId);
  const project = await WorkspaceProject.findOne({ _id: projectId, userId });
  if (!project) throw workbenchError('项目不存在', 404);
  return project;
}
