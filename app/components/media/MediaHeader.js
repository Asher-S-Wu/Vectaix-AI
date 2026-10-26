"use client";

import { useI18n } from "@/lib/client/i18n";
import Link from '@/app/components/layout/NavigationMotion';
import { usePathname } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getMediaWorkspaces } from '@/lib/media/shared/workspaces';
export default function MediaHeader() {
  const { t, locale } = useI18n();


  const pathname = usePathname();
  const admin = pathname.startsWith('/admin/');
  if (pathname === '/admin/media') return null;
  return <header className="mb-7">{admin && <Link href="/admin/media" className="mb-5 inline-flex min-h-10 items-center gap-2 text-sm text-zinc-500"><ArrowLeft size={15} />{t("媒体设置", "Media settings")}</Link>}<nav aria-label={t("媒体工作区", "Media workspace")} className="flex flex-wrap gap-2">{!admin && <Link href="/media" aria-current={pathname === '/media' ? 'page' : undefined} className={`rounded-lg px-4 py-3 text-sm ${pathname === '/media' ? 'bg-primary/10 font-medium text-primary' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>{t("创作首页", "Overview")}</Link>}{getMediaWorkspaces(locale, { admin }).map(item => <Link key={item.href} href={item.href} aria-current={pathname === item.href ? 'page' : undefined} className={`rounded-lg px-4 py-3 text-sm ${pathname === item.href ? 'bg-primary/10 font-medium text-primary' : 'text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'}`}>{item.label}</Link>)}</nav></header>;
}
