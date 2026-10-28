'use client';

import { AudioLines, BookOpen, Cpu, Terminal, Users } from 'lucide-react';
import { useI18n } from '@/lib/client/i18n';
import ModelsPanel from './ModelsPanel';
import GlobalSkillsPanel from './GlobalSkillsPanel';
import SandboxPanel from './SandboxPanel';
import AdminMediaPanel from './AdminMediaPanel';
import UsersPanel from '../settings/panels/UsersPanel';

const panels = { models: ModelsPanel, skills: GlobalSkillsPanel, sandbox: SandboxPanel, media: AdminMediaPanel, image: AdminMediaPanel, audio: AdminMediaPanel, users: UsersPanel };

export function getAdminSection(section) {
  return Object.hasOwn(panels, section) ? section : 'models';
}

export default function AdminPanel({ section, onSectionChange }) {
  const { t } = useI18n();
  const activeCategory = ['image', 'audio'].includes(section) ? 'media' : section;
  const Panel = panels[section];
  const entries = [
    ['models', t('模型服务', 'Model services'), Cpu],
    ['skills', t('全局技能', 'Global skills'), BookOpen],
    ['sandbox', t('云端沙盒', 'Cloud sandbox'), Terminal],
    ['media', t('图片与语音', 'Images and audio'), AudioLines],
    ['users', t('用户管理', 'Users'), Users],
  ];

  return <div className="space-y-5">
    <nav aria-label={t('后台管理', 'Administration')} className="admin-panel-nav">
      {entries.map(([id, label, Icon]) => <button key={id} type="button" onClick={() => onSectionChange(id)} aria-current={activeCategory === id ? 'page' : undefined}>
        <Icon size={17} aria-hidden="true" /><span>{label}</span>
      </button>)}
    </nav>
    <div className="admin-panel-content">
      <Panel key={activeCategory} section={section} onSectionChange={onSectionChange} />
    </div>
  </div>;
}
