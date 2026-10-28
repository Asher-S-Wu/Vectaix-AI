"use client";

import { useI18n } from "@/lib/client/i18n";
import Link from '@/app/components/layout/NavigationMotion';
import { usePathname } from 'next/navigation';
import { getMediaWorkspaces } from '@/lib/media/shared/workspaces';
export default function MediaHeader() {
  const { t, locale } = useI18n();


  const pathname = usePathname();
  return <header className="mb-7"><nav aria-label={t("媒体工作区", "Media workspace")} className="flex gap-1 overflow-x-auto"><Link href="/media" aria-current={pathname === '/media' ? 'page' : undefined} className={`whitespace-nowrap rounded-lg px-4 py-2.5 text-sm transition-colors ${pathname === '/media' ? 'bg-primary/10 font-medium text-primary' : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800'}`}>{t("创作首页", "Overview")}</Link>{getMediaWorkspaces(locale).map(item => <Link key={item.href} href={item.href} aria-current={pathname === item.href ? 'page' : undefined} className={`whitespace-nowrap rounded-lg px-4 py-2.5 text-sm transition-colors ${pathname === item.href ? 'bg-primary/10 font-medium text-primary' : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800'}`}>{item.label}</Link>)}</nav></header>;
}
