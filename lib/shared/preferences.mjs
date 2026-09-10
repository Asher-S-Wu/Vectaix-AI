import { parse, stringify } from 'yaml';

export const DEFAULT_ASSISTANT = Object.freeze({ name: 'Vectaix', avatarFileId: null, language: 'zh', style: '', instructions: '' });
export const DEFAULT_APPEARANCE = Object.freeze({ themeMode: 'system', fontSize: 'medium', completionSoundVolume: 50 });
export const PERMISSION_LABELS = Object.freeze({ camera: '拍照上传', microphone: '录音输入', clipboard: '读取剪贴板', geolocation: '获取位置', notifications: '完成通知', browser: '网页操作', externalTools: '外部工具' });
export const DEFAULT_PERMISSIONS = Object.freeze(Object.fromEntries(Object.keys(PERMISSION_LABELS).map(key => [key, false])));

function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('设置内容格式无效');
}
function text(value, max) {
  if (typeof value !== 'string' || value.length > max) throw new Error(`文字最多 ${max} 个字`);
  return value.trim();
}
export function validatePreferences(body) {
  const result = {};
  for (const group of ['assistant', 'appearance', 'permissions']) {
    if (!Object.hasOwn(body, group)) continue;
    object(body[group]);
    const allowed = { assistant: DEFAULT_ASSISTANT, appearance: DEFAULT_APPEARANCE, permissions: DEFAULT_PERMISSIONS }[group];
    const value = {};
    for (const [key, item] of Object.entries(body[group])) {
      if (!Object.hasOwn(allowed, key)) throw new Error('存在不支持的设置');
      if (group === 'permissions') {
        if (typeof item !== 'boolean') throw new Error('权限必须为开关值');
        value[key] = item;
      } else if (key === 'avatarFileId') {
        if (item !== null && (typeof item !== 'string' || !/^[\w-]{1,100}$/.test(item))) throw new Error('头像编号无效');
        value[key] = item;
      } else if (key === 'completionSoundVolume') {
        if (!Number.isFinite(item) || item < 0 || item > 100) throw new Error('提示音音量须为 0–100');
        value[key] = item;
      } else {
        const choices = { language: ['zh', 'en', 'auto'], themeMode: ['light', 'dark', 'system'], fontSize: ['small', 'medium', 'large'] }[key];
        if (choices && !choices.includes(item)) throw new Error('所选设置值不受支持');
        value[key] = text(item, key === 'instructions' ? 20000 : key === 'style' ? 1000 : 100);
        if (key === 'name' && !value[key]) throw new Error('助手名称不能为空');
      }
    }
    result[group] = value;
  }
  return result;
}

export function assistantPrompt(assistant) {
  return `助手名称：${assistant.name}\n表达风格：${assistant.style}\n语言：${assistant.language === 'auto' ? '跟随用户' : assistant.language === 'zh' ? '简体中文' : '英语'}\n长期偏好（当前用户要求优先）：\n${assistant.instructions}`;
}
export function formatSoul(assistant) {
  const { instructions, ...metadata } = { ...DEFAULT_ASSISTANT, ...validatePreferences({ assistant }).assistant };
  return `---\n${stringify(metadata)}---\n${instructions}\n`;
}
export function parseSoul(content) {
  if (typeof content !== 'string' || content.length > 30000) throw new Error('SOUL.md 文件过大或无效');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error('SOUL.md 须包含名称、语言等文件头信息');
  const metadata = parse(match[1], { maxAliasCount: 0 });
  object(metadata);
  const { name, avatarFileId, language, style } = metadata;
  const values = Object.fromEntries(Object.entries({ name, avatarFileId, language, style }).filter(([,value]) => value !== undefined));
  return { ...DEFAULT_ASSISTANT, ...validatePreferences({ assistant: { ...values, instructions: match[2].trim() } }).assistant };
}
