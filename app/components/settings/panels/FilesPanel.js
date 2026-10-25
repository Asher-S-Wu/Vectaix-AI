'use client';

import { useI18n } from '@/lib/client/i18n';
import Select from '@/app/components/common/Select';
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

export default function FilesPanel() {
  const { t, locale, formatDate, formatNumber, localizeMessage } = useI18n();
  const sizeLabel = size => size < 1024 ? `${formatNumber(size)} B` : size < 1024 * 1024 ? `${formatNumber(size / 1024, { maximumFractionDigits: 1 })} KB` : `${formatNumber(size / 1024 / 1024, { maximumFractionDigits: 1 })} MB`;
  const ownerLabels = { library: t("个人文件", "Personal files"), project: t("项目文件", "Project files"), conversation: t("对话附件", "Chat attachments"), task: t("任务文件", "Task files"), temporary: t("临时文件", "Temporary files"), avatar: t("头像", "Avatar"), 'image-result': t("图片生成", "Generated image"), 'audio-generation': t("语音生成", "Generated speech") };
  const ownerLabel = type => ownerLabels[type];

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
  const compare = (a, b) => sort === 'size' ? b.size - a.size : sort === 'updated' ? new Date(b.updatedAt) - new Date(a.updatedAt) : a.name.localeCompare(b.name, locale === "zh" ? "zh-CN" : "en-US", { numeric: true });
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
  }, ["已开始下载", "Download started"]);
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
  const titles = { file: t("文件详情", "File details"), rename: t("重命名文件", "Rename file"), edit: t("编辑文本", "Edit text"), move: t("移动文件", "Move files"), copy: t("复制到项目", "Copy to project"), delete: t("删除文件", "Delete files"), createFolder: t("新建文件夹", "New folder"), renameFolder: t("重命名文件夹", "Rename folder"), moveFolder: t("移动文件夹", "Move folder"), deleteFolder: t("删除文件夹", "Delete folder") };
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
  }, ["操作完成", "Done"]);
  const folderActions = folder => <div className="flex flex-wrap gap-2">
    <button className={buttonClass} disabled={busy || loading} onClick={() => setDialog({ type: 'renameFolder', folder, name: folder.name })}>{t("重命名", "Rename")}</button>
    <button className={buttonClass} disabled={busy || loading} onClick={() => setDialog({ type: 'moveFolder', folder, target: folder.parentId || '' })}>{t("移动", "Move")}</button>
    <button className={`${buttonClass} text-red-600`} disabled={busy || loading} onClick={() => setDialog({ type: 'deleteFolder', folder })}>{t("删除", "Delete")}</button>
  </div>;
  const moveFolders = dialog?.type === 'moveFolder' ? data.folders.filter(folder => {
    for (let item = folder; item; item = data.folders.find(parent => parent._id === item.parentId)) if (item._id === dialog.folder._id) return false;
    return true;
  }) : data.folders;

  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="font-semibold">{t("个人文件库", "Your file library")}</h3><p className="mt-1 text-sm text-zinc-500">{t("整理附件和生成文件，随时下载或复制到项目。", "Organize attachments and generated files. Download them or copy them to a project.")}</p></div>
      <button className={buttonClass} disabled={busy || loading} onClick={() => act(load, ["已刷新", "Refreshed"])}><RefreshCw size={16} />{t("刷新", "Refresh")}</button>
    </div>
    {error && !dialog && <p role="alert" className="text-sm text-red-500">{localizeMessage(error)}</p>}
    {notice && <p role="status" className="text-sm text-emerald-600">{t(...notice)}</p>}
    <nav aria-label={t("文件夹路径", "Folder path")} className="flex flex-wrap items-center gap-2 text-sm">
      <button disabled={busy} className="text-primary" onClick={() => navigate('')}>{t("根目录", "Root folder")}</button>
      {breadcrumbs.map(folder => <span key={folder._id} className="flex min-w-0 items-center gap-2"><span className="text-zinc-400">/</span><button disabled={busy} className="break-all" onClick={() => navigate(folder._id)}>{folder.name}</button></span>)}
    </nav>
    <div className="flex flex-wrap gap-2">
      <label className={`${buttonClass} cursor-pointer ${busy || loading ? 'opacity-50' : ''}`}><Upload size={16} />{t("上传文件", "Upload files")}<input aria-label={t("上传文件", "Upload files")} type="file" multiple className="sr-only" disabled={busy || loading} onChange={e => {
        const uploads = [...e.target.files]; e.target.value = ''; if (!uploads.length) return;
        act(async () => { const body = new FormData(); for (const file of uploads) body.append('files', file); if (folderId) body.append('folderId', folderId); await request('/api/library/upload', { method: 'POST', body }); await load(); }, ["上传完成", "Upload complete"]);
      }} /></label>
      <button className={buttonClass} disabled={busy || loading} onClick={() => setDialog({ type: 'createFolder', name: '' })}><Plus size={16} />{t("新建文件夹", "New folder")}</button>
      {currentFolder && folderActions(currentFolder)}
    </div>
    <div className="flex flex-col gap-2 sm:flex-row">
      <label className="relative flex-1"><Search size={16} className="absolute left-3 top-3 text-zinc-400" /><input aria-label={t("搜索当前文件夹", "Search this folder")} placeholder={t("搜索此文件夹中的文件和文件夹", "Search files and folders here")} className={`${fieldClass} pl-9`} value={query} disabled={busy} onChange={e => { setQuery(e.target.value); setSelected([]); }} /></label>
      <Select ariaLabel={t("文件排序", "Sort files")} className={`${fieldClass} sm:w-40`} value={sort} onChange={e => setSort(e)} options={[{
  id: "name",
  label: t("名称排序", "Name")
}, {
  id: "updated",
  label: t("最近修改", "Recently modified")
}, {
  id: "size",
  label: t("大小从大到小", "Largest first")
}]} />
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <button disabled={busy || loading || !files.length} className={buttonClass} onClick={toggleAll}>{allSelected ? t("取消全选", "Deselect all") : t("全选", "Select all")}</button>
      <button disabled={busy || loading || !files.length} className={buttonClass} onClick={() => setSelected(files.filter(file => !selected.includes(file.fileId)).map(file => file.fileId))}>{t("反选", "Invert selection")}</button>
      <span className="text-xs text-zinc-500">{loading ? t("加载中…", "Loading…") : t("{files} 个文件 · {folders} 个文件夹", "{files} files · {folders} folders", { files: formatNumber(files.length), folders: formatNumber(folders.length) }) + (selected.length ? t(" · 已选 {count} 个文件", " · {count} selected", { count: formatNumber(selected.length) }) : "")}</span>
    </div>
    {selected.length > 0 && !loading && <div className="flex flex-wrap gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3" aria-label={t("批量操作", "Bulk actions")}>
      <button disabled={busy || selected.length > 100} className={buttonClass} onClick={() => download(selected)}><Download size={16} />{t("批量下载", "Download selected")}</button>
      <button disabled={busy} className={buttonClass} onClick={() => openMove(selected)}>{t("移动所选", "Move selected")}</button>
      <button disabled={busy || !projects.length} className={buttonClass} onClick={() => setDialog({ type: 'copy', ids: selected, target: '' })}>{t("复制到项目", "Copy to project")}</button>
      <button disabled={busy} className={`${buttonClass} text-red-600`} onClick={() => openDelete(selected)}>{t("删除所选", "Delete selected")}</button>
      {selected.length > 100 && <p className="w-full text-xs text-zinc-500">{t("一次最多打包下载 100 个文件。", "You can download up to 100 files in one archive.")}</p>}
    </div>}
    <div className="space-y-2" aria-busy={loading || busy}>
      {loading ? <p className="py-8 text-center text-sm text-zinc-500">{t("正在加载文件…", "Loading files…")}</p> : <>
        {folders.map(folder => <div key={folder._id} className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-700"><button disabled={busy} onClick={() => navigate(folder._id)} className="flex min-w-0 flex-1 items-center gap-3 text-left"><Folder size={20} className="shrink-0 text-amber-500" /><span className="truncate text-sm">{folder.name}</span></button>{folderActions(folder)}</div>)}
        {files.map(file => <div key={file.fileId} className={`flex items-center gap-3 rounded-xl border p-3 ${selected.includes(file.fileId) ? 'border-primary/40 bg-primary/5' : 'border-zinc-200 dark:border-zinc-700'}`}>
          <input aria-label={t("选择 {name}", "Select {name}", { name: file.name })} type="checkbox" className="h-4 w-4 shrink-0 accent-primary" disabled={busy} checked={selected.includes(file.fileId)} onChange={e => setSelected(current => e.target.checked ? [...current, file.fileId] : current.filter(id => id !== file.fileId))} />
          <File size={18} className="hidden shrink-0 text-zinc-400 sm:block" />
          <button disabled={busy} onClick={() => openFile(file)} className="min-w-0 flex-1 text-left"><span className="block truncate text-sm" title={file.name}>{file.name}</span><span className="text-xs text-zinc-500">{sizeLabel(file.size)} · {ownerLabel(file.ownerType)}</span>{file.deletionBlockedReason && <span className="block text-xs text-amber-700 dark:text-amber-400">{localizeMessage(file.deletionBlockedReason)}</span>}</button>
          <a href={file.url} download={file.name} aria-label={t("下载 {name}", "Download {name}", { name: file.name })} className="rounded-lg p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"><Download size={17} /></a>
          <button disabled={busy} aria-label={t("管理 {name}", "Manage {name}", { name: file.name })} className="rounded-lg p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => openFile(file)}><MoreHorizontal size={18} /></button>
        </div>)}
        {!files.length && !folders.length && <p className="py-10 text-center text-sm text-zinc-500">{query ? t("没有找到匹配的文件或文件夹。", "No matching files or folders.") : t("这里还没有文件，上传文件开始整理。", "This folder is empty. Upload files to get started.")}</p>}
      </>}
    </div>
    {dialog && <ChatSettingsDialog title={titles[dialog.type]} onClose={closeDialog}>
      {error && <p role="alert" className="text-sm text-red-500">{localizeMessage(error)}</p>}
      {dialog.type === 'file' ? <fieldset disabled={busy} className="space-y-4">
        <p className="break-all font-medium">{dialog.file.name}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm"><dt className="text-zinc-500">{t("大小", "Size")}</dt><dd>{sizeLabel(dialog.file.size)}</dd><dt className="text-zinc-500">{t("来源", "Source")}</dt><dd>{ownerLabel(dialog.file.ownerType)}</dd><dt className="text-zinc-500">{t("位置", "Location")}</dt><dd className="break-all">{folderId ? folderPath(folderId) : t("根目录", "Root folder")}</dd>{dialog.file.updatedAt && <><dt className="text-zinc-500">{t("修改时间", "Modified")}</dt><dd>{formatDate(dialog.file.updatedAt, { dateStyle: "medium", timeStyle: "short" })}</dd></>}</dl>
        {dialog.file.deletionBlockedReason && <p className="text-sm text-amber-700 dark:text-amber-400">{localizeMessage(dialog.file.deletionBlockedReason)}</p>}
        <div className="flex flex-wrap gap-2"><a className={buttonClass} href={dialog.file.url} download={dialog.file.name}>{t("下载", "Download")}</a><button className={buttonClass} onClick={() => setDialog({ type: 'rename', file: dialog.file, name: dialog.file.name })}>{t("重命名", "Rename")}</button><button className={buttonClass} onClick={() => openMove([dialog.file.fileId])}>{t("移动", "Move")}</button><button className={buttonClass} disabled={!projects.length} onClick={() => setDialog({ type: 'copy', ids: [dialog.file.fileId], target: '' })}>{t("复制到项目", "Copy to project")}</button>{dialog.file.editable && dialog.file.size <= 200000 && <button disabled={busy} className={buttonClass} onClick={() => openEdit(dialog.file)}>{t("编辑文本", "Edit text")}</button>}<button className={`${buttonClass} text-red-600`} onClick={() => openDelete([dialog.file.fileId])}>{t("删除", "Delete")}</button></div>
      </fieldset> : <form className="space-y-4" onSubmit={e => { e.preventDefault(); saveDialog(); }}>
        {dialog.name !== undefined && <label className="block space-y-2 text-sm"><span>{dialog.type.endsWith('Folder') ? t("文件夹名称", "Folder name") : t("文件名称", "File name")}</span><input autoFocus required maxLength={200} className={fieldClass} value={dialog.name} disabled={busy} onChange={e => setDialog({ ...dialog, name: e.target.value })} /></label>}
        {dialog.type === 'edit' && <label className="block space-y-2 text-sm"><span>{t("文本内容", "Text content")}</span><textarea required rows={12} className={`${fieldClass} font-mono`} value={dialog.content} disabled={busy} onChange={e => setDialog({ ...dialog, content: e.target.value })} /></label>}
        {['move', 'moveFolder', 'copy'].includes(dialog.type) && <label className="block space-y-2 text-sm"><span>{dialog.type === 'copy' ? t("目标项目", "Destination project") : t("目标文件夹", "Destination folder")}</span><Select className={fieldClass} value={dialog.target} disabled={busy} required={dialog.type === 'copy'} onChange={e => setDialog({
  ...dialog,
  target: e
})} options={[{
  id: "",
  label: dialog.type === 'copy' ? t("请选择项目", "Choose a project") : t("根目录", "Root folder")
}, ...(dialog.type === 'copy' ? projects : moveFolders).map(item => ({
  id: item._id,
  label: dialog.type === 'copy' ? item.name : folderPath(item._id)
}))]} /></label>}
        {dialog.type === 'delete' && <div className="space-y-3">
          {dialog.blocked.length > 0 && <><p className="text-sm text-amber-700 dark:text-amber-400">{t("以下 {count} 个文件需要到原位置删除：", "Delete these {count} files from their original locations:", { count: formatNumber(dialog.blocked.length) })}</p><ul className="max-h-56 space-y-2 overflow-y-auto rounded-xl border border-amber-200 p-3">{dialog.blocked.map(file => <li key={file.fileId} className="text-sm"><p className="break-all font-medium">{file.name}</p><p className="text-xs text-zinc-500">{localizeMessage(file.deletionBlockedReason)}</p></li>)}</ul></>}
          <p className="text-sm leading-6">{dialog.ids.length ? t("确定永久删除这 {count} 个文件？删除后无法恢复。", "Permanently delete these {count} files? This action is permanent.", { count: formatNumber(dialog.ids.length) }) : t("所选文件均不可在这里删除。", "The selected files must be deleted from their original locations.")}</p>
        </div>}
        {dialog.type === 'deleteFolder' && <p className="break-all text-sm leading-6">{t("确定永久删除“{name}”及其中的所有文件和子文件夹？删除后无法恢复。", "Permanently delete “{name}” and all its files and subfolders? This action is permanent.", { name: dialog.folder.name })}</p>}
        <div className="flex justify-end gap-2"><button type="button" disabled={busy} className={buttonClass} onClick={closeDialog}>{t("取消", "Cancel")}</button><button disabled={busy || (dialog.name !== undefined && !dialog.name.trim()) || (dialog.type === 'copy' && !dialog.target) || (dialog.type === 'move' && dialog.target === folderId) || (dialog.type === 'moveFolder' && dialog.target === (dialog.folder.parentId || '')) || (dialog.ids && !dialog.ids.length)} className={`rounded-xl px-4 py-2 text-sm text-white disabled:opacity-50 ${dialog.type.startsWith('delete') ? 'bg-red-600' : 'bg-primary'}`}>{busy ? t("处理中…", "Processing…") : dialog.type === 'delete' ? t("确认删除 {count} 个文件", "Delete {count} files", { count: formatNumber(dialog.ids.length) }) : dialog.type.startsWith('delete') ? t("确认删除", "Delete permanently") : t("保存", "Save")}</button></div>
      </form>}
    </ChatSettingsDialog>}
  </div>;
}
