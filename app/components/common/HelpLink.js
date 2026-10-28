"use client";

import { BookOpen } from 'lucide-react';
import Link from '../layout/NavigationMotion';
import { useI18n } from '@/lib/client/i18n';

export default function HelpLink({ href = '/help' }) {
  const { t } = useI18n();
  const label = t('帮助文档', 'Help docs');

  return <Link href={href} aria-label={label} title={label} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-primary">
    <BookOpen size={17} aria-hidden="true" />
    <span className="hidden sm:inline">{t('文档', 'Docs')}</span>
  </Link>;
}
