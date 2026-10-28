const ink = '#426955';
const dough = '#FFFDF3';
const leaf = '#B9C9A9';
const gold = '#EDCA75';
const blue = '#89B9C5';

const origins = {
  welcome: '64px 51px', login: '19px 60px', register: '40px 67px',
  studio: '40px 19px', settings: '65px 60px', assistant: '24px 66px',
  browser: '65px 40px', files: '40px 66px', permissions: '65px 59px',
};

const artwork = {
  welcome: <path d="M62 52c5-1 7-5 7-10 0-4 3-6 5-3 3 6 0 16-8 19" fill={dough} />,
  chat: <>
    <path d="M63 57c-2 5-8 8-13 4-3-3-1-6 2-5l4 1" fill={dough} />
    <g data-mascot-detail="thought" fill={gold} stroke="none"><circle cx="69" cy="31" r="2" /><circle cx="73" cy="23" r="3" /><circle cx="68" cy="14" r="4" /></g>
  </>,
  login: <>
    <path d="M16 51c-5-2-8 1-7 6 1 4 7 6 12 3M60 60c5 3 11 1 12-3 1-5-2-8-7-6" fill={dough} />
    <path d="M7 63h67" stroke={leaf} />
  </>,
  register: <>
    <path d="m40 60 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z" fill={gold} />
    <path d="M30 61c-5-1-8 2-5 5l7 4M50 61c5-1 8 2 5 5l-7 4" fill={dough} />
  </>,
  studio: <>
    <path d="M23 18C14 8 32 1 44 4c13-3 25 8 18 14-9 6-27 7-39 0Z" fill={leaf} />
    <path d="m28 22 32-5M42 4l3-3" />
  </>,
  image: <>
    <path d="M19 56C8 53 2 62 7 69c4 6 17 7 21 0 2-3-5-3-5-6 0-2 1-5-4-7Z" fill={dough} />
    <g stroke="none"><circle cx="12" cy="62" r="2" fill={gold} /><circle cx="13" cy="69" r="2" fill={blue} /><circle cx="21" cy="69" r="2" fill={leaf} /></g>
    <g data-mascot-detail="brush" style={{ transformBox: 'view-box', transformOrigin: '67px 57px' }}>
      <path d="m64 65 8-23 4 2-8 23Z" fill={gold} />
      <path d="M72 43c-2-5 1-9 6-11l-2 12Z" fill={ink} />
      <path d="M62 56c-4-3-6 1-3 4l7 2c4 0 5-5 1-6Z" fill={dough} />
    </g>
  </>,
  audio: <>
    <path d="M12 39C10 2 70 0 70 39" strokeWidth="4" />
    <rect x="7" y="34" width="12" height="19" rx="6" fill={leaf} />
    <rect x="63" y="34" width="12" height="19" rx="6" fill={leaf} />
    <g data-mascot-detail="note" fill={gold} stroke={gold}><path d="M73 23V12l6-2v5l-6 2" /><ellipse cx="70" cy="24" rx="3" ry="2" /></g>
  </>,
  settings: <>
    <path d="M68 38c-5 0-8 5-5 9l-9 17c-2 4 4 7 6 3l9-17c5 0 8-6 5-10l-3 6-5-3Z" fill={leaf} />
    <path d="M60 55c-4-3-7 1-4 4l7 2c4 0 5-5 1-6Z" fill={dough} />
  </>,
  general: <g data-mascot-detail="sun">
    <circle cx="68" cy="20" r="6" fill={gold} />
    <path d="M68 9V6m0 28v-3M57 20h-3m23 0h3M60 12l-2-2m20 20-2-2M60 28l-2 2m20-20-2 2" stroke={gold} />
  </g>,
  assistant: <>
    <path d="M8 57c7-2 13-1 18 3 5-4 11-5 18-3v18c-7-2-13-1-18 2-5-3-11-4-18-2Z" fill={dough} />
    <path d="M26 60v17M13 63l8 2m-8 3 8 2m10-5 8-2m-8 7 8-2" stroke={leaf} />
    <path d="M8 62c-5-1-6 4-2 6l4 1M44 62c5-1 6 4 2 6l-4 1" fill={dough} />
  </>,
  connections: <>
    <path d="M17 61 9 67m56-6 8 6" stroke={leaf} strokeWidth="3" />
    <g data-mascot-detail="plug-left"><path d="m8 47 8 11-6 5-8-11Z" fill={blue} /><path d="m4 48-3-4m9 0-3-4" /><path d="M13 56c4-3 7 0 5 3l-3 3" fill={dough} /></g>
    <g data-mascot-detail="plug-right"><path d="m72 47-8 11 6 5 8-11Z" fill={gold} /><path d="m76 48 3-4m-9 0 3-4" /><path d="M67 56c-4-3-7 0-5 3l3 3" fill={dough} /></g>
  </>,
  browser: <>
    <path d="m63 40 10 15" strokeWidth="5" />
    <circle cx="59" cy="31" r="11" fill={blue} fillOpacity=".7" strokeWidth="3" />
    <path d="M55 27c1-2 4-3 6-2" stroke={dough} />
    <path d="M68 48c-5-2-7 2-3 5l5 2c4-1 4-5 1-6Z" fill={dough} />
  </>,
  files: <>
    <path d="M21 58h12l5 5h23v15H21Z" fill={gold} />
    <path d="M23 63h40l-4 15H19Z" fill={dough} />
    <path d="M22 61c-5-1-7 3-3 6l4 1M61 61c5-1 7 3 3 6l-4 1" fill={dough} />
  </>,
  backups: <>
    <path d="M7 59h27v18H7Z" fill={leaf} /><path d="M5 56h31v7H5Z" fill={dough} />
    <path d="M16 68h9" />
    <g data-mascot-detail="backup-arrow"><path d="M21 43v10m-5-5 5 5 5-5" stroke={gold} strokeWidth="3" /></g>
  </>,
  permissions: <>
    <path d="m65 48 12 5v9c0 8-12 15-12 15s-12-7-12-15v-9Z" fill={leaf} />
    <path d="m59 61 4 4 8-9" stroke={dough} strokeWidth="3" />
    <path d="M54 55c-5-1-7 3-3 6l4 1" fill={dough} />
  </>,
  usage: <>
    <rect x="49" y="49" width="29" height="27" rx="4" fill={dough} />
    <g data-mascot-detail="chart-bars" fill={leaf} stroke="none"><rect x="54" y="63" width="5" height="8" rx="1" /><rect x="61" y="58" width="5" height="13" rx="1" fill={blue} /><rect x="68" y="53" width="5" height="18" rx="1" fill={gold} /></g>
    <path d="M50 58c-4-1-5 4-2 6l4 1" fill={dough} />
  </>,
  models: <>
    <g data-mascot-detail="core"><rect x="55" y="49" width="22" height="22" rx="5" fill={leaf} /><path d="M60 49v-5m6 5v-5m6 5v-5M60 71v5m6-5v5m6-5v5M55 54h-5m5 6h-5m5 6h-5m27-12h5m-5 6h5m-5 6h5" /><rect x="61" y="55" width="10" height="10" rx="2" fill={dough} /></g>
  </>,
  skills: <>
    <g data-mascot-detail="star-left"><path d="m10 26 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z" fill={gold} /></g>
    <g data-mascot-detail="star-right"><path d="m71 13 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" fill={blue} /></g>
    <path d="M16 51c-5-4-10-2-9 2 1 3 5 5 9 5M64 51c5-4 10-2 9 2-1 3-5 5-9 5" fill={dough} />
  </>,
  sandbox: <>
    <rect x="21" y="61" width="40" height="17" rx="4" fill={ink} />
    <path d="m28 65 4 4-4 4m10 0h7" stroke={dough} />
    <path d="M22 62c-5-1-7 3-3 6l4 1M60 62c5-1 7 3 3 6l-4 1" fill={dough} />
  </>,
  media: <>
    <rect x="54" y="47" width="24" height="21" rx="3" fill={leaf} />
    <g data-mascot-detail="clapper"><path d="m53 40 23-5 2 7-24 5Z" fill={dough} /><path d="m58 39 5 5m4-7 5 5" /></g>
    <path d="m62 53 7 4-7 4Z" fill={dough} stroke="none" />
    <path d="M55 54c-5-1-7 3-3 6l4 1" fill={dough} />
  </>,
  users: <>
    <g data-mascot-detail="person-left"><circle cx="28" cy="62" r="5" fill={gold} /><path d="M19 77v-4c0-8 18-8 18 0v4Z" fill={gold} /></g>
    <g data-mascot-detail="person-right"><circle cx="53" cy="62" r="5" fill={blue} /><path d="M44 77v-4c0-8 18-8 18 0v4Z" fill={blue} /></g>
  </>,
  help: <>
    <g strokeWidth="1.5">
      <circle cx="30" cy="52" r="6.5" /><circle cx="51" cy="52" r="6.5" />
      <path d="M36.5 51c2-2 6-2 8 0M23.5 50 19 48m38.5 2L62 48" />
    </g>
    <path d="M41 63c5-2 11-1 16 2 5-3 11-4 17-2v15c-7-2-12-1-17 1-5-2-10-3-16-1Z" fill={blue} />
    <path d="M43 61c5-1 10 0 14 3 4-3 9-4 15-3v14c-6-1-11 0-15 2-4-2-9-3-14-2Z" fill={dough} />
    <path d="M57 64v13m5-11 6-1m-6 5 6-1" stroke={leaf} />
    <g data-mascot-detail="guide-page" style={{ transformBox: 'view-box', transformOrigin: '57px 70px' }}>
      <path d="M57 64c-4-4-8-6-12-6v15c4 0 8 1 12 4Z" fill={dough} />
      <path d="m48 63 5 2m-5 3 5 2" stroke={leaf} />
    </g>
    <path d="M70 68c5-1 7 3 3 6l-4 1" fill={dough} />
  </>,
};

export default function HuajuanAccessories({ variant }) {
  return (
    <g
      data-mascot-prop={variant}
      fill="none"
      stroke={ink}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transformBox: 'view-box', transformOrigin: origins[variant] }}
    >
      {artwork[variant]}
    </g>
  );
}
