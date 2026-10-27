'use client';

import { useI18n } from "@/lib/client/i18n";

import Link from '@/app/components/layout/NavigationMotion';
import { usePathname } from 'next/navigation';
import { ArrowLeft, AudioLines, BookOpen, Cpu, Terminal, Users } from 'lucide-react';
import BrandMark from '@/app/components/common/BrandMark';



export default function AdminShell({ children, email }) {
  const { t } = useI18n();

const entries = [
  { href: '/admin', label: t("模型服务", "Model services"), description: t("连接与模型", "Connections and models"), icon: Cpu },
  { href: '/admin/skills', label: t("全局技能", "Global skills"), description: t("统一工作方法", "Shared workflows"), icon: BookOpen },
  { href: '/admin/sandbox', label: t("云端沙盒", "Cloud sandbox"), description: t("Python 与技能脚本", "Python and skill scripts"), icon: Terminal },
  { href: '/admin/media', label: t("图片与语音", "Images and audio"), description: t("媒体服务与默认参数", "Media services and defaults"), icon: AudioLines },
  { href: '/admin/users', label: t("用户管理", "Users"), description: t("账号与密码", "Accounts and passwords"), icon: Users },
];
  const pathname = usePathname();
  return <div className="admin-shell">
    <aside className="admin-sidebar">
      <Link href="/" className="admin-brand"><BrandMark size={42} /><span>{t("花卷", "Huajuan")}<span className="block text-xs font-normal text-zinc-500">{t("管理后台", "Admin")}</span></span></Link>
      <nav aria-label={t("后台管理", "Administration")}>{entries.map(({href,label,description,icon:Icon}) => <Link key={href} href={href} aria-current={(href === '/admin' ? pathname === href : pathname.startsWith(href)) ? 'page' : undefined} className="admin-nav-item"><Icon size={18} /><span>{label}<small>{description}</small></span></Link>)}</nav>
      <div className="admin-sidebar-footer"><span className="block truncate text-xs text-zinc-500">{email}</span><Link href="/" className="-ml-2 mt-3 flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm text-zinc-600 transition-colors hover:bg-primary/10 hover:text-primary"><ArrowLeft size={15} />{t("返回对话", "Back to chat")}</Link></div>
    </aside>
    <main className="admin-main">{children}</main>
  </div>;
}
