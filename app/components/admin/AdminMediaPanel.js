'use client';

import { useI18n } from '@/lib/client/i18n';
import MediaSettingsPanel from './MediaSettingsPanel';
import ImageWorkspace from '../media/ImageWorkspace';
import SpeechWorkspace from '../media/SpeechWorkspace';

export default function AdminMediaPanel({ section, onSectionChange }) {
  const { t } = useI18n();
  const entries = [
    ['media', t('媒体设置', 'Media settings')],
    ['image', t('图片生成', 'Image generation')],
    ['audio', t('语音合成', 'Text to speech')],
  ];

  return <>
    <nav aria-label={t('媒体工作区', 'Media workspace')} className="mb-6 flex flex-wrap gap-1">
      {entries.map(([id, label]) => <button key={id} type="button" onClick={() => onSectionChange(id)} aria-current={section === id ? 'page' : undefined} className={`rounded-lg px-4 py-2.5 text-sm transition-colors ${section === id ? 'bg-primary/10 font-medium text-primary' : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800'}`}>{label}</button>)}
    </nav>
    {section === 'media' && <>
      <header className="admin-page-heading"><h1>{t('图片与语音', 'Images and audio')}</h1><p>{t('统一管理图片与语音服务，设置所有用户共用的创作能力。', 'Manage image and audio services and their settings for all users.')}</p></header>
      <MediaSettingsPanel />
    </>}
    {section === 'image' && <ImageWorkspace canManageDefaults />}
    {section === 'audio' && <SpeechWorkspace canManageDefaults />}
  </>;
}
