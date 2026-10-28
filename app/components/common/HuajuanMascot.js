"use client";

import { useId, useState } from 'react';
import { useI18n } from '@/lib/client/i18n';
import BrandMark from './BrandMark';
import HuajuanAccessories from './HuajuanAccessories';
import styles from './HuajuanMascot.module.css';

const poses = {
  welcome: { pose: 'rotate(-3 40 65)', activity: ['花卷正在挥手欢迎你', 'Huajuan is waving hello'] },
  chat: { pose: 'rotate(-7 40 65)', expression: 'thinking', faceTransform: 'translate(1 -1)', activity: ['花卷正在托腮思考', 'Huajuan is thinking'] },
  login: { pose: 'translate(2 3) rotate(6 40 65) scale(.96)', activity: ['花卷正在探头等你', 'Huajuan is peeking out to welcome you'] },
  register: { pose: 'rotate(3 40 65)', expression: 'happy', activity: ['花卷捧着一颗小星星', 'Huajuan is holding a little star'] },
  studio: { pose: 'rotate(-5 40 65)', expression: 'wink', activity: ['花卷戴好画家帽，准备开工', 'Huajuan has a beret on, ready to create'] },
  image: { pose: 'rotate(-6 40 65)', faceTransform: 'translate(1 -1)', activity: ['花卷正在挥动画笔', 'Huajuan is painting'] },
  audio: { expression: 'happy', activity: ['花卷戴着耳机，跟着节奏摇摆', 'Huajuan is swaying to the music'] },
  settings: { pose: 'rotate(6 40 65)', activity: ['花卷拿着小扳手', 'Huajuan has a little wrench'] },
  general: { pose: 'rotate(3 40 65)', expression: 'happy', activity: ['花卷正在转动小太阳', 'Huajuan is turning a little sun'] },
  assistant: { pose: 'rotate(-4 40 65)', faceTransform: 'translate(0 1)', activity: ['花卷正在翻看笔记', 'Huajuan is reading a notebook'] },
  connections: { pose: 'translate(0 1)', activity: ['花卷正在连接两个插头', 'Huajuan is joining two plugs'] },
  browser: { pose: 'rotate(8 40 65)', faceTransform: 'translate(2 -1)', expression: 'thinking', activity: ['花卷正在拿放大镜找资料', 'Huajuan is exploring with a magnifying glass'] },
  files: { pose: 'rotate(-3 40 65)', expression: 'happy', activity: ['花卷正抱着文件夹', 'Huajuan is holding your folder'] },
  backups: { pose: 'translate(0 2)', faceTransform: 'translate(-1 1)', activity: ['花卷正在收好备份盒', 'Huajuan is packing a backup box'] },
  permissions: { pose: 'rotate(-2 40 65)', activity: ['花卷正在举盾守护', 'Huajuan is standing guard with a shield'] },
  usage: { pose: 'rotate(-5 40 65)', faceTransform: 'translate(1 -2)', activity: ['花卷正在看用量图表', 'Huajuan is checking the usage chart'] },
  models: { pose: 'rotate(5 40 65)', expression: 'thinking', activity: ['花卷正在调试小芯片', 'Huajuan is tuning a little chip'] },
  skills: { pose: 'rotate(3 40 65)', expression: 'happy', activity: ['花卷正在练习星星魔法', 'Huajuan is practicing a little star magic'] },
  sandbox: { pose: 'translate(0 2) rotate(-2 40 65)', faceTransform: 'translate(0 1)', activity: ['花卷正在小电脑上敲字', 'Huajuan is typing on a little computer'] },
  media: { pose: 'rotate(5 40 65)', expression: 'wink', activity: ['花卷导演正在打板', 'Director Huajuan is ready for action'] },
  users: { pose: 'rotate(-4 40 65)', expression: 'happy', activity: ['花卷正在招呼小伙伴', 'Huajuan is welcoming friends'] },
  help: { pose: 'rotate(2 40 65)', faceTransform: 'translate(0 1)', activity: ['花卷戴着眼镜，正在翻阅指南', 'Huajuan is reading a guide with glasses on'] },
};

export default function HuajuanMascot({ size = 48, variant = 'welcome', className = '' }) {
  const { t } = useI18n();
  const descriptionId = useId();
  const [greeting, setGreeting] = useState(0);
  const label = t('和花卷打个招呼', 'Say hello to Huajuan');
  const { activity, ...character } = poses[variant];

  return (
    <button
      type="button"
      className={`${styles.mascot} ${className}`.trim()}
      data-huajuan-variant={variant}
      aria-label={label}
      aria-describedby={descriptionId}
      title={t('{activity}。点我打个招呼', '{activity}. Click to say hello', { activity: t(...activity) })}
      onClick={() => setGreeting(value => value + 1)}
    >
      <span key={greeting} className={`${styles.art} ${greeting > 0 ? styles.greeting : ''}`} aria-hidden="true">
        <BrandMark size={size} {...character}><HuajuanAccessories variant={variant} /></BrandMark>
      </span>
      <span id={descriptionId} className="sr-only">{t(...activity)}</span>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {greeting > 0 && <span key={greeting}>{t('花卷开心地向你打招呼。', 'Huajuan happily says hello back.')}</span>}
      </span>
    </button>
  );
}
