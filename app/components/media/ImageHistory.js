'use client';

import { useEffect, useRef, useState } from 'react';
import { History, RefreshCw, Trash2 } from 'lucide-react';
import { useI18n } from '@/lib/client/i18n';
import { apiJson } from '@/lib/client/apiClient';
import ImageResultCard from './image-result-card';
import MediaConfirmDialog from './MediaConfirmDialog';

export default function ImageHistory({ refreshKey, onDeleted }) {
  const { t, formatDate } = useI18n();
  const [images, setImages] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const requestId = useRef(0);
  useEffect(() => {
    const controller = new AbortController(), id = ++requestId.current;
    async function load() {
      setLoading(true); setError('');
      try { const data = await apiJson('/api/media/image/history', { signal: controller.signal }); if (id === requestId.current && !controller.signal.aborted) { setImages(data.images); setCursor(data.nextCursor); } }
      catch (error) { if (id === requestId.current && !controller.signal.aborted) setError(error.message); }
      finally { if (id === requestId.current && !controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [refreshKey, revision]);
  async function loadMore() {
    const id = ++requestId.current;
    setLoading(true); setError('');
    try { const data = await apiJson(`/api/media/image/history?cursor=${encodeURIComponent(cursor)}`); if (id === requestId.current) { setImages(current => [...current, ...data.images]); setCursor(data.nextCursor); } }
    catch (error) { if (id === requestId.current) setError(error.message); }
    finally { if (id === requestId.current) setLoading(false); }
  }
  async function remove() {
    const file = deleting; setDeleting(null); setBusy(true); setError('');
    try { await apiJson(`/api/media/image/history/${encodeURIComponent(file.fileId)}`, { method: 'DELETE' }); requestId.current += 1; setLoading(false); setImages(current => current.filter(image => image.fileId !== file.fileId)); onDeleted?.(file.fileId); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  return <section className="mt-10 border-t border-zinc-200 pt-7 dark:border-zinc-800" aria-label={t('图片记录', 'Image history')}>
    <div className="mb-5 flex items-center justify-between gap-4"><h2 className="flex items-center gap-2 text-base font-semibold"><History size={18} className="text-primary" />{t('图片记录', 'Image history')}</h2><button disabled={loading || busy} onClick={() => setRevision(value => value + 1)} className="admin-button"><RefreshCw size={15} />{t('刷新记录', 'Refresh history')}</button></div>
    {error && <p role="alert" className="mb-4 text-sm text-red-600">{error}</p>}
    {!loading && !images.length && !error && <p className="py-8 text-sm text-zinc-500">{t('生成的图片会保存在这里，换页后也可以继续查看、下载和删除。', 'Generated images are saved here. Return any time to view, download, or delete them.')}</p>}
    <div className="grid gap-5 lg:grid-cols-2">{images.map(file => <article key={file.fileId} className="min-w-0"><ImageResultCard imageUrl={file.url} title={formatDate(file.createdAt, { dateStyle: 'medium', timeStyle: 'short' })} /><button disabled={busy} onClick={() => setDeleting(file)} className="mt-2 inline-flex min-h-11 items-center gap-2 px-2 text-xs text-zinc-500 hover:text-red-600"><Trash2 size={14} />{t('删除图片', 'Delete image')}</button></article>)}</div>
    {loading && <p role="status" className="py-5 text-sm text-zinc-500">{t('正在读取图片记录…', 'Loading image history…')}</p>}
    {cursor && <button disabled={loading || busy} onClick={loadMore} className="admin-button mt-5">{t('加载更多', 'Load more')}</button>}
    <MediaConfirmDialog open={Boolean(deleting)} title={t('删除图片', 'Delete image')} message={t('删除这张图片及其保存文件？此操作无法撤销。', 'Delete this image and its saved file? This action is permanent.')} danger onClose={() => setDeleting(null)} onConfirm={remove} />
  </section>;
}
