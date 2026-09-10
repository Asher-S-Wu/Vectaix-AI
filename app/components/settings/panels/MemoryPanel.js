"use client";

import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/client/apiClient';
import { Section, Field, Action, Toggle, ErrorNotice, usePanelData, inputClass } from '../SettingsUI';

export default function MemoryPanel({ projectId, conversationId }) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const path = `/api/memories?${new URLSearchParams({ ...(projectId ? { projectId } : {}), q: query })}`;
  const panel = usePanelData(path);
  const {setError}=panel;
  const [enabled, setEnabled] = useState(null);
  const [project, setProject] = useState(null);
  const [capabilities, setCapabilities] = useState(null);
  const [editor, setEditor] = useState(null);
  const [deleting, setDeleting] = useState(null);
  useEffect(() => {
    let disposed = false;
    Promise.all([apiJson('/api/memories/settings'), projectId ? apiJson(`/api/projects/${projectId}`) : null, conversationId ? apiJson(`/api/conversations/${conversationId}/capabilities`) : null]).then(([personal, projectData, conversation]) => { if (!disposed) { setEnabled(personal.enabled); setProject(projectData?.project); setCapabilities(conversation); } }).catch(error => { if (!disposed) setError(error.message); });
    return () => { disposed = true; };
  }, [projectId, conversationId,setError]);
  const edit = item => setEditor(item || { content: '', projectId: projectId || '' });
  return <><ErrorNotice error={panel.error} /><Section title="记忆使用范围" description="关闭后，AI 不再读取或自动保存对应范围的记忆，已有内容仍可管理。">{enabled !== null && <Toggle label="个人记忆" checked={enabled} onChange={value => panel.run(async () => setEnabled((await apiJson('/api/memories/settings', { method: 'PUT', body: { enabled: value } })).enabled))} />}{project && <Toggle label={`项目记忆 · ${project.name}`} checked={project.memoryEnabled} onChange={value => panel.run(async () => setProject((await apiJson(`/api/projects/${projectId}`, { method: 'PUT', body: { memoryEnabled: value } })).project))} />}{capabilities && <Toggle label="当前对话使用记忆" checked={capabilities.memoryEnabled} onChange={value => panel.run(async () => setCapabilities(await apiJson(`/api/conversations/${conversationId}/capabilities`, { method: 'PUT', body: { memoryEnabled: value } })))} />}</Section>
    <Section title={editor ? editor._id ? '编辑记忆' : '添加记忆' : '已保存的记忆'}>{editor ? <form className="space-y-4" onSubmit={event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); values.projectId = values.projectId || null; panel.run(async () => { await apiJson(`/api/memories${editor._id ? `/${editor._id}` : ''}`, { method: editor._id ? 'PUT' : 'POST', body: values }); await panel.reload(); setEditor(null); }); }}><Field label="记忆内容"><textarea className={inputClass} name="content" defaultValue={editor.content} rows={6} maxLength={4000} required /></Field><Field label="使用范围"><select name="projectId" defaultValue={editor.projectId || ''} className={inputClass}><option value="">个人</option>{project && <option value={projectId}>{project.name}</option>}</select></Field><div className="flex gap-2"><Action type="submit" primary disabled={panel.busy}>保存</Action><Action onClick={() => setEditor(null)}>取消</Action></div></form> : <>
      <form className="flex gap-2" onSubmit={event => { event.preventDefault(); setQuery(search); }}><input className={inputClass} aria-label="搜索记忆" placeholder="搜索记忆内容" value={search} onChange={event => setSearch(event.target.value)} /><Action type="submit">搜索</Action><Action onClick={() => edit()} primary>添加</Action></form>
      <div className="space-y-3">{panel.data?.memories.map(item => <article key={item._id} className="space-y-3 rounded-xl bg-zinc-50 p-4 dark:bg-zinc-800/50"><div className="flex flex-wrap gap-2 text-xs text-zinc-500"><span>{item.projectId ? '项目记忆' : '个人记忆'}</span><span>· {item.source === 'automatic' ? 'AI 保存' : '手动添加'}</span><time>{new Date(item.updatedAt).toLocaleString('zh-CN')}</time></div><p className="whitespace-pre-wrap text-sm leading-6">{item.content}</p><div className="flex gap-3 text-xs"><button className="text-primary" onClick={() => edit(item)}>编辑</button><button className="text-red-500" onClick={() => setDeleting(item._id)}>删除</button></div>{deleting === item._id && <div className="flex items-center gap-3 border-t border-zinc-200 pt-3 text-sm dark:border-zinc-700"><span>删除这条记忆？</span><Action danger disabled={panel.busy} onClick={() => panel.run(async () => { await apiJson(`/api/memories/${item._id}`, { method: 'DELETE' }); await panel.reload(); setDeleting(null); })}>删除</Action><Action onClick={() => setDeleting(null)}>取消</Action></div>}</article>)}</div>
      {panel.data && !panel.data.memories.length && <p className="py-6 text-center text-sm text-zinc-500">还没有符合条件的记忆。</p>}{panel.data?.nextCursor && <Action disabled={panel.busy} onClick={() => panel.run(async () => { const result = await apiJson(`${path}&cursor=${panel.data.nextCursor}`); panel.setData({ ...result, memories: [...panel.data.memories, ...result.memories] }); })}>加载更多</Action>}
    </>}</Section></>;
}
