import Conversation from '@/models/Conversation';
import WorkbenchTask from '@/models/WorkbenchTask';
import UserSettings from '@/models/UserSettings';

function collectReferences(value, target) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi)) target.add(match[0].toLowerCase());
  } else if (Array.isArray(value)) {
    for (const item of value) collectReferences(item, target);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectReferences(item, target);
  }
}

async function fileReferences(userId, { excludeConversationIds = [], excludeTaskIds = [], remainingConversation = null } = {}) {
  const [conversations, tasks, settings] = await Promise.all([
    Conversation.find({ userId, _id: { $nin: excludeConversationIds } }).select('title messages').lean(),
    WorkbenchTask.find({ userId, _id: { $nin: excludeTaskIds } }).select('artifacts output mediaTasks prompt').lean(),
    UserSettings.findOne({ userId }).select('avatarFileId assistant').lean(),
  ]);
  if (remainingConversation) conversations.push(remainingConversation);
  const references = new Map();
  const add = (value, label, nextStep) => {
    const ids = new Set();
    collectReferences(JSON.parse(JSON.stringify(value)), ids);
    for (const id of ids) if (!references.has(id)) references.set(id, { label, nextStep });
  };
  for (const conversation of conversations) add(conversation.messages, `对话“${conversation.title}”`, '请先到该对话移除附件或删除引用消息');
  for (const task of tasks) add({ artifacts: task.artifacts, output: task.output, mediaTasks: task.mediaTasks }, `任务“${task.prompt?.slice(0, 60) || task._id}”`, '请先在对应对话删除引用该文件的任务回复');
  add(settings, '个人资料或助手头像', '请先在设置中更换或移除头像');
  return references;
}

export async function referencedFileIds(userId) {
  return new Set((await fileReferences(userId)).keys());
}

export async function assertStoredFilesUnreferenced(userId, files, options) {
  if (!files.length) return;
  const references = await fileReferences(userId, options);
  const file = files.find(item => references.has(item.fileId));
  if (file) {
    const reference = references.get(file.fileId);
    throw Object.assign(new Error(`“${file.originalName}”正被${reference.label}使用，${reference.nextStep}`), { status: 409 });
  }
}
