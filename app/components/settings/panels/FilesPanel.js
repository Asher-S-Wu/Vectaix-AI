'use client';

import { useEffect, useState } from 'react';
import { Download, File, Folder, MoreHorizontal, Plus, RefreshCw, Search, Upload } from 'lucide-react';
import ChatSettingsDialog, { fieldClass, buttonClass } from '@/app/components/chat/ChatSettingsDialog';

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const sizeLabel = size => size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
const ownerLabels = { library: '个人文件', project: '项目文件', conversation: '对话附件', task: '任务文件', temporary: '临时文件', avatar: '头像', 'image-result': '图片生成', 'video-task': '视频生成', 'video-enhancement-task': '视频增强', 'audio-generation': '语音生成', 'voice-profile': '音色', 'audio-processing': '音频处理' };
const ownerLabel = type => ownerLabels[type];

export default function FilesPanel() {
  const [data, setData] = useState({ files: [], folders: [] });
  const [folderId, setFolderId] = useState('');
  const [selected, setSelected] = useState([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('name');
  const [dialog, setDialog] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState([]);

  useEffect(() => {
    let active = true;
    request(`/api/library?folderId=${folderId}`).then(value => {
      if (active) setData(value);
    }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [folderId]);
  useEffect(() => {
    request('/api/projects').then(value => setProjects(value.projects)).catch(e => setError(e.message));
  }, []);

  const navigate = id => {
    if (id === folderId) return;
    setFolderId(id); setSelected([]); setQuery(''); setDialog(null); setError(''); setNotice(''); setLoading(true);
  };
  const load = async () => {
    const value = await request(`/api/library?folderId=${folderId}`);
    setData(value);
    setSelected(current => current.filter(id => value.files.some(file => file.fileId === id)));
  };
  const act = async (fn, message) => {
    setBusy(true); setError(''); setNotice('');
    try { await fn(); if (message) setNotice(message); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const currentFolder = data.folders.find(folder => folder._id === folderId);
  const folderPath = id => {
    const names = [];
    for (let folder = data.folders.find(item => item._id === id); folder; folder = data.folders.find(item => item._id === folder.parentId)) names.unshift(folder.name);
    return names.join(' / ');
  };
  const breadcrumbs = [];
  for (let folder = currentFolder; folder; folder = data.folders.find(item => item._id === folder.parentId)) breadcrumbs.unshift(folder);
  const compare = (a, b) => sort === 'size' ? b.size - a.size : sort === 'updated' ? new Date(b.updatedAt) - new Date(a.updatedAt) : a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
  const files = data.files.filter(file => file.name.toLowerCase().includes(query.trim().toLowerCase())).sort(compare);
  const folders = data.folders.filter(folder => (folder.parentId || '') === folderId && folder.name.toLowerCase().includes(query.trim().toLowerCase()));
  const allSelected = files.length > 0 && files.every(file => selected.includes(file.fileId));
  const toggleAll = () => setSelected(allSelected ? [] : files.map(file => file.fileId));
  const download = ids => act(async () => {
    const response = await fetch('/api/library/download', json('POST', { fileIds: ids }));
    if (!response.ok) throw new Error((await response.json()).error);
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'files.zip'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, '已开始下载');
  const openFile = file => setDialog({ type: 'file', file });
  const openEdit = file => act(async () => {
    const result = await request(`/api/library/files/${file.fileId}?text=1`);
    setDialog({ type: 'edit', file: result.file, name: result.file.name, content: result.content });
  });
  const openMove = ids => setDialog({ type: 'move', ids, target: folderId });
  const openDelete = ids => act(async () => {
    const value = await request(`/api/library?folderId=${folderId}`);
    setData(value);
    const chosen = value.files.filter(file => ids.includes(file.fileId));
    setSelected(current => current.filter(id => value.files.some(file => file.fileId === id)));
    setDialog({ type: 'delete', ids: chosen.filter(file => !file.deletionBlockedReason).map(file => file.fileId), blocked: chosen.filter(file => file.deletionBlockedReason) });
  });
  const titles = { file: '文件详情', rename: '重命名文件', edit: '编辑文本', move: '移动文件', copy: '复制到项目', delete: '删除文件', createFolder: '新建文件夹', renameFolder: '重命名文件夹', moveFolder: '移动文件夹', deleteFolder: '删除文件夹' };
  const closeDialog = () => { if (!busy) { setDialog(null); setError(''); } };
  const saveDialog = () => act(async () => {
    const { type } = dialog;
    if (type === 'rename' || type === 'edit') await request(`/api/library/files/${dialog.file.fileId}`, json('PATCH', { name: dialog.name.trim(), ...(type === 'edit' ? { content: dialog.content } : {}) }));
    if (type === 'createFolder') await request('/api/library/folders', json('POST', { name: dialog.name.trim(), parentId: folderId || null }));
    if (type === 'renameFolder') await request(`/api/library/folders/${dialog.folder._id}`, json('PATCH', { name: dialog.name.trim() }));
    if (type === 'moveFolder') await request(`/api/library/folders/${dialog.folder._id}`, json('PATCH', { parentId: dialog.target || null }));
    if (type === 'delete') {
      await request('/api/library', json('DELETE', { fileIds: dialog.ids }));
      setSelected(current => current.filter(id => !dialog.ids.includes(id)));
      setData(current => ({ ...current, files: current.files.filter(file => !dialog.ids.includes(file.fileId)) }));
    }
    if (['move', 'copy'].includes(type)) {
      for (const id of dialog.ids) {
        if (type === 'move') await request(`/api/library/files/${id}`, json('PATCH', { folderId: dialog.target || null }));
        if (type === 'copy') await request(`/api/library/files/${id}/copy`, json('POST', { projectId: dialog.target }));
        setSelected(current => current.filter(value => value !== id));
        if (type === 'move' && dialog.target !== folderId) setData(current => ({ ...current, files: current.files.filter(file => file.fileId !== id) }));
        setDialog(current => ({ ...current, ids: current.ids.filter(value => value !== id) }));
      }
    }
    if (type === 'deleteFolder') {
      await request(`/api/library/folders/${dialog.folder._id}`, { method: 'DELETE' });
      if (dialog.folder._id === folderId) { navigate(dialog.folder.parentId || ''); return; }
    }
    await load(); setDialog(null);
  }, '操作完成');
  const folderActions = folder => <div className="flex flex-wrap gap-2">
    <button className={buttonClass} disabled={busy || loading} onClick={() => setDialog({ type: 'renameFolder', folder, name: folder.name })}>重命名</button>
    <button className={buttonClass} disabled={busy || loading} onClick={() => setDialog({ type: 'moveFolder', folder, target: folder.parentId || '' })}>移动</button>
    <button className={`${buttonClass} text-red-600`} disabled={busy || loading} onClick={() => setDialog({ type: 'deleteFolder', folder })}>删除</button>
  </div>;
  const moveFolders = dialog?.type === 'moveFolder' ? data.folders.filter(folder => {
    for (let item = folder; item; item = data.folders.find(parent => parent._id === item.parentId)) if (item._id === dialog.folder._id) return false;
    return true;
  }) : data.folders;

  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="font-semibold">个人文件库</h3><p className="mt-1 text-sm text-zinc-500">整理附件和生成文件，随时下载或复制到项目。</p></div>
      <button className={buttonClass} disabled={busy || loading} onClick={() => act(load, '已刷新')}><RefreshCw size={16} />刷新</button>
    </div>
    {error && !dialog && <p role="alert" className="text-sm text-red-500">{error}</p>}
    {notice && <p role="status" className="text-sm text-emerald-600">{notice}</p>}
    <nav aria-label="文件夹路径" className="flex flex-wrap items-center gap-2 text-sm">
      <button disabled={busy} className="text-primary" onClick={() => navigate('')}>根目录</button>
      {breadcrumbs.map(folder => <span key={folder._id} className="flex min-w-0 items-center gap-2"><span className="text-zinc-400">/</span><button disabled={busy} className="break-all" onClick={() => navigate(folder._id)}>{folder.name}</button></span>)}
    </nav>
    <div className="flex flex-wrap gap-2">
      <label className={`${buttonClass} cursor-pointer ${busy || loading ? 'opacity-50' : ''}`}><Upload size={16} />上传文件<input aria-label="上传文件" type="file" multiple className="sr-only" disabled={busy || loading} onChange={e => {
        const uploads = [...e.target.files]; e.target.value = ''; if (!uploads.length) return;
        act(async () => { const body = new FormData(); for (const file of uploads) body.append('files', file); if (folderId) body.append('folderId', folderId); await request('/api/library/upload', { method: 'POST', body }); await load(); }, '上传完成');
      }} /></label>
      <button className={buttonClass} disabled={busy || loading} onClick={() => setDialog({ type: 'createFolder', name: '' })}><Plus size={16} />新建文件夹</button>
      {currentFolder && folderActions(currentFolder)}
    </div>
    <div className="flex flex-col gap-2 sm:flex-row">
      <label className="relative flex-1"><Search size={16} className="absolute left-3 top-3 text-zinc-400" /><input aria-label="搜索当前文件夹" placeholder="搜索此文件夹中的文件和文件夹" className={`${fieldClass} pl-9`} value={query} disabled={busy} onChange={e => { setQuery(e.target.value); setSelected([]); }} /></label>
      <select aria-label="文件排序" className={`${fieldClass} sm:w-40`} value={sort} onChange={e => setSort(e.target.value)}><option value="name">名称排序</option><option value="updated">最近修改</option><option value="size">大小从大到小</option></select>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <button disabled={busy || loading || !files.length} className={buttonClass} onClick={toggleAll}>{allSelected ? '取消全选' : '全选'}</button>
      <button disabled={busy || loading || !files.length} className={buttonClass} onClick={() => setSelected(files.filter(file => !selected.includes(file.fileId)).map(file => file.fileId))}>反选</button>
      <span className="text-xs text-zinc-500">{loading ? '加载中…' : `${files.length} 个文件 · ${folders.length} 个文件夹${selected.length ? ` · 已选 ${selected.length} 个文件` : ''}`}</span>
    </div>
    {selected.length > 0 && !loading && <div className="flex flex-wrap gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3" aria-label="批量操作">
      <button disabled={busy || selected.length > 100} className={buttonClass} onClick={() => download(selected)}><Download size={16} />批量下载</button>
      <button disabled={busy} className={buttonClass} onClick={() => openMove(selected)}>移动所选</button>
      <button disabled={busy || !projects.length} className={buttonClass} onClick={() => setDialog({ type: 'copy', ids: selected, target: '' })}>复制到项目</button>
      <button disabled={busy} className={`${buttonClass} text-red-600`} onClick={() => openDelete(selected)}>删除所选</button>
      {selected.length > 100 && <p className="w-full text-xs text-zinc-500">一次最多打包下载 100 个文件。</p>}
    </div>}
    <div className="space-y-2" aria-busy={loading || busy}>
      {loading ? <p className="py-8 text-center text-sm text-zinc-500">正在加载文件…</p> : <>
        {folders.map(folder => <div key={folder._id} className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-700"><button disabled={busy} onClick={() => navigate(folder._id)} className="flex min-w-0 flex-1 items-center gap-3 text-left"><Folder size={20} className="shrink-0 text-amber-500" /><span className="truncate text-sm">{folder.name}</span></button>{folderActions(folder)}</div>)}
        {files.map(file => <div key={file.fileId} className={`flex items-center gap-3 rounded-xl border p-3 ${selected.includes(file.fileId) ? 'border-primary/40 bg-primary/5' : 'border-zinc-200 dark:border-zinc-700'}`}>
          <input aria-label={`选择 ${file.name}`} type="checkbox" className="h-4 w-4 shrink-0 accent-primary" disabled={busy} checked={selected.includes(file.fileId)} onChange={e => setSelected(current => e.target.checked ? [...current, file.fileId] : current.filter(id => id !== file.fileId))} />
          <File size={18} className="hidden shrink-0 text-zinc-400 sm:block" />
          <button disabled={busy} onClick={() => openFile(file)} className="min-w-0 flex-1 text-left"><span className="block truncate text-sm" title={file.name}>{file.name}</span><span className="text-xs text-zinc-500">{sizeLabel(file.size)} · {ownerLabel(file.ownerType)}</span>{file.deletionBlockedReason && <span className="block text-xs text-amber-700 dark:text-amber-400">{file.deletionBlockedReason}</span>}</button>
          <a href={file.url} download={file.name} aria-label={`下载 ${file.name}`} className="rounded-lg p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"><Download size={17} /></a>
          <button disabled={busy} aria-label={`管理 ${file.name}`} className="rounded-lg p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => openFile(file)}><MoreHorizontal size={18} /></button>
        </div>)}
        {!files.length && !folders.length && <p className="py-10 text-center text-sm text-zinc-500">{query ? '没有找到匹配的文件或文件夹。' : '这里还没有文件，上传文件开始整理。'}</p>}
      </>}
    </div>
    {dialog && <ChatSettingsDialog title={titles[dialog.type]} onClose={closeDialog}>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      {dialog.type === 'file' ? <fieldset disabled={busy} className="space-y-4">
        <p className="break-all font-medium">{dialog.file.name}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm"><dt className="text-zinc-500">大小</dt><dd>{sizeLabel(dialog.file.size)}</dd><dt className="text-zinc-500">来源</dt><dd>{ownerLabel(dialog.file.ownerType)}</dd><dt className="text-zinc-500">位置</dt><dd className="break-all">{folderId ? folderPath(folderId) : '根目录'}</dd>{dialog.file.updatedAt && <><dt className="text-zinc-500">修改时间</dt><dd>{new Date(dialog.file.updatedAt).toLocaleString('zh-CN')}</dd></>}</dl>
        {dialog.file.deletionBlockedReason && <p className="text-sm text-amber-700 dark:text-amber-400">{dialog.file.deletionBlockedReason}</p>}
        <div className="flex flex-wrap gap-2"><a className={buttonClass} href={dialog.file.url} download={dialog.file.name}>下载</a><button className={buttonClass} onClick={() => setDialog({ type: 'rename', file: dialog.file, name: dialog.file.name })}>重命名</button><button className={buttonClass} onClick={() => openMove([dialog.file.fileId])}>移动</button><button className={buttonClass} disabled={!projects.length} onClick={() => setDialog({ type: 'copy', ids: [dialog.file.fileId], target: '' })}>复制到项目</button>{dialog.file.editable && dialog.file.size <= 200000 && <button disabled={busy} className={buttonClass} onClick={() => openEdit(dialog.file)}>编辑文本</button>}<button className={`${buttonClass} text-red-600`} onClick={() => openDelete([dialog.file.fileId])}>删除</button></div>
      </fieldset> : <form className="space-y-4" onSubmit={e => { e.preventDefault(); saveDialog(); }}>
        {dialog.name !== undefined && <label className="block space-y-2 text-sm"><span>{dialog.type.endsWith('Folder') ? '文件夹名称' : '文件名称'}</span><input autoFocus required maxLength={200} className={fieldClass} value={dialog.name} disabled={busy} onChange={e => setDialog({ ...dialog, name: e.target.value })} /></label>}
        {dialog.type === 'edit' && <label className="block space-y-2 text-sm"><span>文本内容</span><textarea required rows={12} className={`${fieldClass} font-mono`} value={dialog.content} disabled={busy} onChange={e => setDialog({ ...dialog, content: e.target.value })} /></label>}
        {['move', 'moveFolder', 'copy'].includes(dialog.type) && <label className="block space-y-2 text-sm"><span>{dialog.type === 'copy' ? '目标项目' : '目标文件夹'}</span><select className={fieldClass} value={dialog.target} disabled={busy} required={dialog.type === 'copy'} onChange={e => setDialog({ ...dialog, target: e.target.value })}><option value="">{dialog.type === 'copy' ? '请选择项目' : '根目录'}</option>{(dialog.type === 'copy' ? projects : moveFolders).map(item => <option key={item._id} value={item._id}>{dialog.type === 'copy' ? item.name : folderPath(item._id)}</option>)}</select></label>}
        {dialog.type === 'delete' && <div className="space-y-3">
          {dialog.blocked.length > 0 && <><p className="text-sm text-amber-700 dark:text-amber-400">以下 {dialog.blocked.length} 个文件不能在这里删除，将予以保留：</p><ul className="max-h-56 space-y-2 overflow-y-auto rounded-xl border border-amber-200 p-3">{dialog.blocked.map(file => <li key={file.fileId} className="text-sm"><p className="break-all font-medium">{file.name}</p><p className="text-xs text-zinc-500">{file.deletionBlockedReason}</p></li>)}</ul></>}
          <p className="text-sm leading-6">{dialog.ids.length ? `确定永久删除${dialog.blocked.length ? '其余' : '所选的'} ${dialog.ids.length} 个文件？删除后无法恢复。` : '所选文件均不可在这里删除。'}</p>
        </div>}
        {dialog.type === 'deleteFolder' && <p className="break-all text-sm leading-6">确定永久删除“{dialog.folder.name}”及其中的所有文件和子文件夹？删除后无法恢复。</p>}
        <div className="flex justify-end gap-2"><button type="button" disabled={busy} className={buttonClass} onClick={closeDialog}>取消</button><button disabled={busy || (dialog.name !== undefined && !dialog.name.trim()) || (dialog.type === 'copy' && !dialog.target) || (dialog.type === 'move' && dialog.target === folderId) || (dialog.type === 'moveFolder' && dialog.target === (dialog.folder.parentId || '')) || (dialog.ids && !dialog.ids.length)} className={`rounded-xl px-4 py-2 text-sm text-white disabled:opacity-50 ${dialog.type.startsWith('delete') ? 'bg-red-600' : 'bg-primary'}`}>{busy ? '处理中…' : dialog.type === 'delete' ? `确认删除 ${dialog.ids.length} 个文件` : dialog.type.startsWith('delete') ? '确认删除' : '保存'}</button></div>
      </form>}
    </ChatSettingsDialog>}
  </div>;
}
