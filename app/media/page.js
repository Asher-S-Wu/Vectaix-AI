'use client';

import { ImagePlus, AudioLines, ArrowUpRight, FolderOpen } from 'lucide-react';
import Link from '@/app/components/layout/NavigationMotion';
import { useI18n } from '@/lib/client/i18n';
import { useMediaAccess } from '@/app/components/media/MediaShell';

export default function MediaPage() {
  const { t } = useI18n();
  const { capabilities } = useMediaAccess();
  const entries = [
    { href: '/media/image', icon: ImagePlus, title: t('图片创作', 'Image creation'), description: t('描述画面生成图片，或上传参考图进行编辑。', 'Describe an image to generate it, or upload reference images to edit.'), detail: 'GPT Image 2.5', enabled: capabilities.image },
    { href: '/media/audio', icon: AudioLines, title: t('语音创作', 'Voice creation'), description: t('把文字变成配音，也可以用自己的录音克隆声音。', 'Turn text into speech, or clone a voice from your own recording.'), detail: 'ElevenLabs', enabled: capabilities.elevenlabs },
  ];
  return <div>
    <header className="media-page-heading"><h1>{t('把想法变成画面与声音', 'Give your ideas an image and a voice')}</h1><p>{t('选择一种创作方式。你的音色和作品保存在自己的账号下。', 'Choose how to create. Your voices and work stay in your own account.')}</p></header>
    <div className="media-studio-grid">{entries.map(({ href, icon: Icon, title, description, detail, enabled }) => <Link key={href} href={href} className="media-studio-entry"><div className="flex items-start justify-between gap-4"><Icon size={34} strokeWidth={1.5} className="text-primary" /><ArrowUpRight size={20} className="text-zinc-400" /></div><h2>{title}</h2><p>{description}</p><div className="media-studio-entry-footer"><span>{detail}</span><span>{enabled ? t('已开通', 'Available') : t('待开通', 'Not enabled')}</span></div></Link>)}</div>
    <Link href="/settings?section=files&returnTo=%2Fmedia" className="mt-8 flex min-h-12 items-center gap-3 text-sm text-zinc-500 hover:text-primary"><FolderOpen size={18} />{t('在“我的文件”中整理和下载作品', 'Organize and download your work in My files')}</Link>
  </div>;
}
