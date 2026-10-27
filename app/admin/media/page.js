'use client';

import { useI18n } from "@/lib/client/i18n";
import Link from '@/app/components/layout/NavigationMotion';
import { AudioLines, ImagePlus } from 'lucide-react';
import MediaSettingsPanel from '@/app/components/admin/MediaSettingsPanel';
export default function MediaPage() {
  const { t } = useI18n();

  return <><header className="admin-page-heading"><h1>{t("图片与语音", "Images and audio")}</h1><p>{t("统一管理图片与语音服务，设置所有用户共用的创作能力。", "Manage image and audio services and their settings for all users.")}</p></header><MediaSettingsPanel /><section className="admin-section"><div className="admin-section-title"><h2>{t("媒体工作区", "Media workspace")}</h2><p>{t("测试生成效果，管理音色并调整全平台默认参数。", "Try generation, manage voices, and set defaults for all users.")}</p></div><div className="grid gap-3 sm:grid-cols-2"><Link href="/admin/media/image" className="flex items-center gap-4 rounded-xl border border-zinc-200 p-5 transition-colors hover:border-primary hover:bg-primary/5 dark:border-zinc-700"><ImagePlus size={24} className="text-primary" /><span><strong className="block text-sm">{t("图片生成", "Image generation")}</strong><span className="mt-1 block text-xs text-zinc-500">{t("生成图片、编辑素材", "Generate and edit images")}</span></span></Link><Link href="/admin/media/audio" className="flex items-center gap-4 rounded-xl border border-zinc-200 p-5 transition-colors hover:border-primary hover:bg-primary/5 dark:border-zinc-700"><AudioLines size={24} className="text-primary" /><span><strong className="block text-sm">{t("语音合成", "Text to speech")}</strong><span className="mt-1 block text-xs text-zinc-500">{t("管理音色、合成语音", "Manage voices and generate speech")}</span></span></Link></div></section></>;
}
