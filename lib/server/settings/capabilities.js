import { stopTasksForSettings } from './stopTasks';
import Conversation from '@/models/Conversation';
import WorkbenchSkill from '@/models/WorkbenchSkill';
import { requireObjectId, workbenchError, booleanField } from '@/lib/server/workbench/apiHelpers';

export async function getConversationCapabilities(userId, id) {
  const conversation = await Conversation.findOne({ _id: requireObjectId(id), userId }).select('settings');
  if (!conversation) throw workbenchError('对话不存在', 404);
  return { memoryEnabled: conversation.settings.memoryEnabled, disabledSkillIds: [...conversation.settings.disabledSkillIds] };
}

export async function updateConversationCapabilities(userId, id, values) {
  await getConversationCapabilities(userId, id);
  const set = {};
  if (Object.hasOwn(values, 'memoryEnabled')) set['settings.memoryEnabled'] = booleanField(values.memoryEnabled, '对话记忆');
  if (Object.hasOwn(values, 'disabledSkillIds')) {
    if (!Array.isArray(values.disabledSkillIds) || values.disabledSkillIds.length > 500) throw workbenchError('技能列表无效');
    const ids = [...new Set(values.disabledSkillIds.map(requireObjectId))];
    if (await WorkbenchSkill.countDocuments({ userId, _id: { $in: ids } }) !== ids.length) throw workbenchError('技能不存在或无权访问');
    set['settings.disabledSkillIds'] = ids;
  }
  if (!Object.keys(set).length) throw workbenchError('请选择要修改的对话设置');
  await Conversation.updateOne({ _id: id, userId }, { $set: set });
  if (values.memoryEnabled === false || values.disabledSkillIds?.length) await stopTasksForSettings(userId, { conversationId: id });
  return getConversationCapabilities(userId, id);
}
