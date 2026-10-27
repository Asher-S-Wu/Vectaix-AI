'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { Images, MessageSquare, Settings2, FolderOpen } from 'lucide-react';
import Link, { useMotionNavigation } from '@/app/components/layout/NavigationMotion';
import { usePathname } from 'next/navigation';
import BrandMark from '@/app/components/common/BrandMark';
import MonthlyUsage from '@/app/components/layout/MonthlyUsage';
import { useI18n } from '@/lib/client/i18n';
import { apiJson } from '@/lib/client/apiClient';
import MediaHeader from './MediaHeader';

const MediaAccess = createContext(null);
export const useMediaAccess = () => useContext(MediaAccess);

export function MediaServiceNotice({ enabled }) {
  const { t } = useI18n();
  const { user } = useMediaAccess();
  if (enabled) return null;
  return <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900 dark:border-amber-900 dark:text-amber-200">
    {t('这项服务尚未开通。已有作品可以查看和删除，创作功能在管理员配置服务后开放。', 'This service has not been enabled. You can view and delete existing work. Creation becomes available after an administrator configures the service.')}
    {user.isAdmin && <Link href="/admin/media" className="ml-2 font-medium underline">{t('前往媒体设置', 'Open media settings')}</Link>}
  </div>;
}

export default function MediaShell({ user, children }) {
  const { t, locale, setLocale, localizeMessage } = useI18n();
  const { navigate } = useMotionNavigation();
  const returnTo = encodeURIComponent(usePathname());
  const [capabilities, setCapabilities] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true); setError(null);
    try { setCapabilities(await apiJson('/api/media/capabilities')); }
    catch (error) { setError(error); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    const controller = new AbortController();
    apiJson('/api/media/capabilities', { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setCapabilities(result);
    }).catch(error => {
      if (!controller.signal.aborted) setError(error);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, []);
  return <MediaAccess.Provider value={{ user, capabilities }}><div className="media-shell">
    <aside className="media-sidebar">
      <Link href="/" className="media-brand"><BrandMark size={38} /><span>{t('花卷', 'Huajuan')}</span></Link>
      <nav aria-label={t('工作空间', 'Workspace')} className="media-primary-nav">
        <Link href="/"><MessageSquare size={18} />{t('对话', 'Chat')}</Link>
        <Link href="/media" aria-current="page"><Images size={18} />{t('媒体创作', 'Media studio')}</Link>
        <Link href={`/settings?section=files&returnTo=${returnTo}`}><FolderOpen size={18} />{t('我的文件', 'My files')}</Link>
      </nav>
      <div className="media-sidebar-footer">
        {user.isAdmin && <Link href="/admin/media"><Settings2 size={17} />{t('媒体设置', 'Media settings')}</Link>}
        <Link href={`/settings?returnTo=${returnTo}`}><Settings2 size={17} /><span className="min-w-0"><span className="block">{t('设置', 'Settings')}</span><span className="mt-1 block truncate text-xs text-zinc-500">{user.email}</span></span></Link>
      </div>
    </aside>
    <div className="media-main">
      <header className="media-topbar">
        <div className="ml-auto flex items-center gap-1"><button type="button" onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')} className="min-h-10 rounded-lg px-3 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-primary" aria-label={t('切换为 English', 'Switch to 中文')}>{locale === 'zh' ? 'English' : '中文'}</button><Link href={`/settings?returnTo=${returnTo}`} className="flex h-10 w-10 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-primary md:hidden" aria-label={t('设置', 'Settings')}><Settings2 size={18} /></Link><MonthlyUsage onOpenUsage={() => navigate(`/settings?section=usage&returnTo=${returnTo}`)} /></div>
      </header>
      <main className="media-content"><div className="media-content-inner"><MediaHeader />
        {loading ? <p role="status" className="py-12 text-sm text-zinc-500">{t('正在读取创作服务…', 'Loading creative services…')}</p> : error ? <div role="alert" className="space-y-4 py-12"><p className="text-sm text-red-600">{localizeMessage(error.message)}</p>{error.status === 401 ? <Link href="/" className="admin-button">{t('重新登录', 'Sign in again')}</Link> : <button type="button" className="admin-button" onClick={() => { setLoading(true); setError(null); void load(); }}>{t('重新加载', 'Reload')}</button>}</div> : children}
      </div></main>
    </div>
  </div></MediaAccess.Provider>;
}
