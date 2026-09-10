export const BACKUP_SECTIONS = ['conversations', 'projects', 'files', 'skills', 'memories', 'settings'];
const pick = (item, keys) => Object.fromEntries(keys.filter(key => item?.[key] !== undefined).map(key => [key, item[key]]));
export function selectSections(value) { if (!Array.isArray(value) || !value.length || value.some(v => !BACKUP_SECTIONS.includes(v))) throw new Error('请选择有效的备份内容'); return [...new Set(value)]; }
export function safeSettings(settings, { includeFiles = true } = {}) {
  return { ...pick(settings, ['nickname', 'chatSystemPrompt', 'memoryEnabled', ...(includeFiles ? ['avatarFileId'] : [])]),
    assistant: pick(settings?.assistant, ['name', 'language', 'style', 'instructions', ...(includeFiles ? ['avatarFileId'] : [])]),
    appearance: pick(settings?.appearance, ['themeMode', 'fontSize', 'completionSoundVolume']),
    chatMediaSettings: safeMediaSettings(settings?.chatMediaSettings),
    systemPrompts: (settings?.systemPrompts || []).map(p => pick(p, ['name', 'content'])),
  };
}
export function safeMediaSettings(value) {
  const result = {};
  const groups = { image: ['size'], audio: ['provider','voiceId','format','sampleRate','instruction','rate','pitch','volume','languageHint','model','emotion','languageBoost','speed','speechRate','loudnessRate','pitchRate'], video: ['mode','resolution','ratio','duration','watermark','audioSetting'], enhancement: ['resolution'] };
  for (const [group, fields] of Object.entries(groups)) if (value?.[group] && typeof value[group] === 'object') {
    result[group] = Object.fromEntries(Object.entries(pick(value[group], fields)).filter(([, item]) => ['string','number','boolean'].includes(typeof item)));
    if (group === 'enhancement' && value.enhancement.bitrate) result[group].bitrate = Object.fromEntries(Object.entries(pick(value.enhancement.bitrate, ['mode','value'])).filter(([, item]) => ['string','number'].includes(typeof item)));
  }
  return result;
}
export function safeConversation(item) {
  const result = pick(item, ['_id', 'title', 'projectId', 'model', 'pinned', 'updatedAt']);
  result.settings = pick(item.settings, ['webSearch', 'memoryEnabled', 'disabledSkillIds']);
  result.messages = (item.messages || []).map(m => pick(m, ['id', 'role', 'content', 'thought', 'type', 'parts', 'createdAt', 'artifacts', 'citations']));
  return result;
}
export function rewriteReferences(value, mappings) {
  if (typeof value === 'string') {
    if (mappings.has(value)) return mappings.get(value);
    return value.replace(/\/api\/(files|skills|projects|conversations)\/([0-9a-f-]{24,36})(?![0-9a-f-])/gi, (full, section, id) => mappings.has(id) ? `/api/${section}/${mappings.get(id)}` : full);
  }
  if (Array.isArray(value)) return value.map(item => rewriteReferences(item, mappings));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteReferences(item, mappings)]));
  return value;
}
export function nextScheduleRun(schedule, now = new Date()) {
  const local = new Date(now.getTime() + 8*3600000);
  const candidate = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), schedule.hour, schedule.minute));
  if (candidate <= local) candidate.setUTCDate(candidate.getUTCDate()+1);
  if (schedule.frequency === 'weekly') while (candidate.getUTCDay() !== schedule.weekday) candidate.setUTCDate(candidate.getUTCDate()+1);
  return new Date(candidate.getTime() - 8*3600000);
}
export function validateManifest(manifest, entries) {
  if (manifest?.format !== 'vectaix-backup' || manifest.version !== 1) throw new Error('不支持的备份格式');
  selectSections(manifest.selection);
  for (const key of ['conversations', 'projects', 'files', 'skills', 'assets', 'memories', 'folders', 'documents']) {
    if (!Array.isArray(manifest[key]) || manifest[key].length > 100000) throw new Error('备份目录无效');
    const ids = new Set();
    for (const item of manifest[key]) {
      if (!/^[a-f0-9]{24}$/i.test(item._id) || ids.has(item._id)) throw new Error('备份包含无效或重复记录');
      ids.add(item._id);
    }
  }
  const fileIds = new Set();
  for (const file of manifest.files) {
    if (!/^[a-f0-9-]{36}$/i.test(file.fileId) || fileIds.has(file.fileId)) throw new Error('备份文件编号无效');
    fileIds.add(file.fileId);
    const data = entries.get(`files/${file.fileId}`); if (!data || data.size !== file.size) throw new Error('备份文件内容缺失或大小不符');
  }
  const skillIds = new Set(manifest.skills.map(s => s._id));
  for (const asset of manifest.assets) { const data = entries.get(`assets/${asset._id}`); if (!skillIds.has(asset.skillId) || !data || data.size !== asset.size) throw new Error('技能附件不完整'); }
  const folders = new Map(manifest.folders.map(f => [f._id, f]));
  for (const folder of manifest.folders) { const visited = new Set([folder._id]); let parent = folder.parentId; while (parent) { if (!folders.has(parent) || visited.has(parent)) throw new Error('文件夹层级无效'); visited.add(parent); parent = folders.get(parent).parentId; } }
  validateDependencies(manifest);
  return Object.fromEntries(BACKUP_SECTIONS.map(key => [key, key === 'settings' ? Number(Boolean(manifest.settings)) : manifest[key].length]));
}

export function validateDependencies(manifest) {
  const ids = Object.fromEntries(['projects','conversations','files','skills'].map(key => [key, new Set(manifest[key].map(item => key === 'files' ? item.fileId : item._id))]));
  const missing = new Set();
  const need = (section, id) => { if (id && !ids[section].has(id)) missing.add(section); };
  for (const memory of manifest.memories) { if ((memory.scope === 'project') !== Boolean(memory.projectId)) throw Object.assign(new Error('记忆所属范围与项目记录不一致'), { status: 400 }); need('projects', memory.projectId); need('conversations', memory.conversationId); }
  for (const conversation of manifest.conversations) { need('projects', conversation.projectId); for (const skillId of conversation.settings?.disabledSkillIds || []) need('skills', skillId); }
  for (const document of manifest.documents) { need('projects', document.projectId); need('conversations', document.conversationId); need('files', document.fileId); }
  for (const file of manifest.files) { if (file.ownerType === 'project') need('projects', file.ownerId); if (file.ownerType === 'conversation') need('conversations', file.ownerId); }
  const visit = value => {
    if (typeof value === 'string') { for (const match of value.matchAll(/\/api\/(files|skills|projects|conversations)\/([0-9a-f-]{24,36})(?![0-9a-f-])/gi)) need(match[1], match[2]); }
    else if (Array.isArray(value)) for (const item of value) visit(item);
    else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) { if (['fileId','avatarFileId'].includes(key)) need('files', item); else visit(item); }
  };
  for (const key of ['conversations','projects','memories','skills','settings']) visit(manifest[key]);
  if (missing.size) {
    const labels = { projects: '项目', conversations: '对话', files: '文件', skills: '技能' };
    const unselected = [...missing].filter(key => !manifest.selection.includes(key));
    throw Object.assign(new Error(unselected.length ? `所选内容引用了${unselected.map(key => labels[key]).join('、')}，请同时选择这些内容` : `关联的${[...missing].map(key => labels[key]).join('、')}缺失，请先清理失效引用再备份`), { status: 400 });
  }
}
