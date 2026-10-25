"use client";
import { Workflow } from 'lucide-react';
import { useI18n } from '@/lib/client/i18n';
export default function ModeSwitcher() {
  const { t } = useI18n();
  return <div className="flex items-center gap-2.5 px-2 py-1.5"><Workflow size={18} className="text-primary" /><span className="text-sm font-semibold">{t('花卷', 'Huajuan')}</span></div>;
}
