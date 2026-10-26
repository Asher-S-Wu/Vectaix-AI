import core from './messages/core-system.mjs';
import admin from './messages/admin-system.mjs';
import task from './messages/task-system.mjs';
import extra from './messages/extra-system.mjs';
import additional from './messages/additional-system.mjs';
import client from './messages/client-system.mjs';

export const systemMessages = [...core, ...admin, ...task, ...extra, ...additional, ...client];
const exact = new Map();
const patterns = [];
const nestedParameters = new Map([
  ['“{0}”正被{1}使用，请先到对应对话移除附件或删除引用消息；头像请在设置中移除', [1]],
  ['“{0}”：{1}', [1]], ['第 {0} 张：{1}', [1]], ['步骤失败：{0}', [0]],
  ['{0}（共 {1} 个文件不可删除）', [0]],
  ['{0}不能为空，且最多 {1} 个字', [0]], ['{0}最多 {1} 个字', [0]], ['{0}必须是开关值', [0]],
]);
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

for (const pair of systemMessages) {
  for (const source of pair) {
    if (!/\{\w+\}/.test(source)) {
      if (!exact.has(source)) exact.set(source, pair);
      continue;
    }
    const keys = [];
    let cursor = 0;
    let pattern = '^';
    for (const match of source.matchAll(/\{(\w+)\}/g)) {
      pattern += escape(source.slice(cursor, match.index)) + '([\\s\\S]*?)';
      keys.push(match[1]);
      cursor = match.index + match[0].length;
    }
    pattern += escape(source.slice(cursor)) + '$';
    patterns.push({ regex: new RegExp(pattern), keys, pair });
  }
}
patterns.sort((a, b) => b.pair[0].replace(/\{\w+\}/g, '').length - a.pair[0].replace(/\{\w+\}/g, '').length);

// Only product-owned system messages use this catalog. User and model content
// is rendered as written; unknown upstream diagnostics remain intact.
export function localizeMessage(message, locale, depth = 0) {
  if (typeof message !== 'string') return message;
  const index = locale === 'en' ? 1 : 0;
  const pair = exact.get(message);
  if (pair) return pair[index];
  for (const entry of patterns) {
    const match = entry.regex.exec(message);
    if (!match) continue;
    const values = Object.fromEntries(entry.keys.map((key, i) => [key, match[i + 1]]));
    if (depth < 3) for (const key of nestedParameters.get(entry.pair[0]) || []) {
      values[key] = localizeMessage(values[key], locale, depth + 1);
    }
    return entry.pair[index].replace(/\{(\w+)\}/g, (_, key) => values[key]);
  }
  return message;
}
